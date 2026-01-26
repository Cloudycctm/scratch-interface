use color_eyre::eyre::{self, Context as _, ContextCompat as _};
use mio::Interest;
use rlbot::flat::{ConnectionSettings, InterfaceMessage, InterfacePacket};
use rlbot::{PacketParseError, flat};
use rlbot_flat::planus::{self, ReadAsRoot as _};
use std::cell::LazyCell;
use std::env;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::str::FromStr;
use std::{net::SocketAddr, thread};
use tracing::{error, info, warn};
use tungstenite::{HandshakeError, accept};

mod runner;

const DEFAULT_BRIDGE_PORT: u16 = 23239;

const TARGET_PACKETRATE: LazyCell<usize> = LazyCell::new(|| {
    env::var("RLBOT_SCRATCH_PACKETRATE")
        .map(|x| {
            x.parse::<usize>()
                .ok()
                .filter(|x| 120 % x == 0)
                .unwrap_or_else(|| {
                    warn!("invalid RLBOT_SCRATCH_PACKETRATE `{x}`, 120 is not divisible by {x}");
                    60
                })
        })
        .unwrap_or(60)
});

/// A WebSocket echo server
fn main() -> eyre::Result<()> {
    tracing_subscriber::fmt().init();

    // TODO: If port is used, find new one and tell deno about it
    let server = std::net::TcpListener::bind(SocketAddr::new(
        "127.0.0.1".parse().unwrap(),
        DEFAULT_BRIDGE_PORT,
    ))
    .context(format!("Couldn't listen on port {DEFAULT_BRIDGE_PORT}"))?;

    thread::spawn(|| {
        if let Ok(path_str) = env::var("SB3_PATH") {
            runner::run_scratch_file(
                &PathBuf::from_str(&path_str)
                    .context("couldn't parse SB3_PATH")
                    .unwrap(),
            )
            .map_err(|e| eyre::eyre!(e))
            .context("Javascript runtime crashed, couldn't run scratch file")
            .unwrap();
            // TODO: We should probably crash the main websocket runtime if this
            //       happens, since we're likely the only client
        }
    });

    let mut threads = vec![];

    for stream in server.incoming() {
        let stream = match stream {
            Ok(stream) => {
                stream.set_nonblocking(true)?;
                mio::net::TcpStream::from_std(stream)
            }
            Err(e) => {
                error!("Couldn't accept stream {e}");
                continue;
            }
        };

        threads.push(thread::spawn(move || {
            let r = handle_client(stream);
            if let Err(e) = &r {
                error!("WS handler crashed: {e:?}");
            };
            r
        }));
    }

    for t in threads {
        t.join().ok().context("couldn't join thread")??;
    }

    Ok(())
}

const INCOMING: mio::Token = mio::Token(0);
const OUTGOING: mio::Token = mio::Token(1);

fn build_packet(p: flat::InterfacePacket, builder: &mut planus::Builder) -> eyre::Result<Vec<u8>> {
    builder.clear();
    let payload = builder.finish(p, None);
    let mut output = u16::try_from(payload.len())
        .map_err(|_| rlbot::PacketBuildError::PayloadTooLarge(payload.len()))?
        .to_be_bytes()
        .to_vec();
    output.extend_from_slice(payload);
    Ok(output)
}

fn handle_client(mut stream: mio::net::TcpStream) -> eyre::Result<()> {
    stream
        .set_nodelay(true)
        .context("couldn't set nodelay for ws stream")?;
    let mut websocket = loop {
        match accept(&mut stream) {
            Ok(x) => {
                break x;
            }
            Err(HandshakeError::Interrupted(_)) => {
                continue; // (WouldBlock)
            }
            Err(e) => return Err(eyre::eyre!("{e}")),
        }
    };

    let env = rlbot::util::AgentEnvironment::from_env();
    let mut rlbot_conn = mio::net::TcpStream::connect(env.server_addr.parse()?)
        .context("couldn't connect to RLBot")?;
    rlbot_conn
        .set_nodelay(true)
        .context("couldn't set nodelay for rlbot stream")?;

    let mut poll = mio::Poll::new().expect("couldn't create mio::Poll");

    poll.registry()
        .register(&mut rlbot_conn, INCOMING, Interest::READABLE)
        .unwrap();
    poll.registry()
        .register(
            *websocket.get_mut(),
            OUTGOING,
            Interest::READABLE | Interest::WRITABLE,
        )
        .unwrap();

    let mut builder = planus::Builder::new();

    // Ready up!
    let connection_settings = build_packet(
        InterfacePacket {
            message: InterfaceMessage::ConnectionSettings(Box::new(ConnectionSettings {
                agent_id: env.agent_id.unwrap_or("bot".into()),
                wants_ball_predictions: false,
                wants_comms: false,
                close_between_matches: true,
            })),
        },
        &mut builder,
    )?;
    rlbot_conn
        .write_all(&connection_settings)
        .context("couldn't send connectionsettings")?;

    let mut rlbot_read_buf = Box::new([0u8; u16::MAX as usize]);
    let mut rlbot_read_view = &mut rlbot_read_buf[0..2];

    info!(
        "Scratch bot bridged to core on port {}",
        rlbot_conn.local_addr().unwrap().port()
    );

    let mut last_sent_tick: usize = 0;
    let tickskip = 120 / *TARGET_PACKETRATE;

    let mut events = mio::Events::with_capacity(128);
    'el: loop {
        poll.poll(&mut events, None)
            .expect("couldn't poll with mio");
        for event in &events {
            match event.token() {
                INCOMING => 'incoming: loop {
                    match rlbot_conn.read_exact(&mut rlbot_read_view) {
                        Ok(_) => (),
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            break 'incoming;
                        }
                        Err(e) => {
                            error!("RLBot connection closed: {e}");
                            break 'el;
                        }
                    };

                    // if we read a payload and not a header
                    if rlbot_read_view.len() > 2 {
                        let packet_ref: flat::CorePacketRef =
                            flat::CorePacketRef::read_as_root(rlbot_read_view)
                                .map_err(PacketParseError::InvalidFlatbuffer)?;
                        let packet: flat::CorePacket = packet_ref.try_into().unwrap();

                        let mut should_send = true;
                        if let flat::CoreMessage::GamePacket(gamepacket) = &packet.message {
                            let frame = gamepacket.match_info.frame_num as usize;
                            if frame - last_sent_tick < tickskip {
                                should_send = false;
                            } else {
                                last_sent_tick = frame;
                            }
                        }

                        if should_send {
                            let json = serde_json::to_string(&packet)
                                .context("couldn't stringify corepacket")?;
                            websocket
                                .send(json.into())
                                .context("couldn't send ws msg")?;
                        }

                        // we should read the header again
                        rlbot_read_view = &mut rlbot_read_buf[0..2]
                    } else {
                        // if we read the header, set view to payload size
                        let payload_size =
                            u16::from_be_bytes([rlbot_read_view[0], rlbot_read_view[1]]) as usize;
                        rlbot_read_view = &mut rlbot_read_buf[0..payload_size];
                    }
                },
                OUTGOING => {
                    if event.is_readable() {
                        'outgoing: loop {
                            let msg = match websocket.read() {
                                Ok(x) => x,
                                Err(tungstenite::Error::Io(ref e))
                                    if e.kind() == std::io::ErrorKind::WouldBlock =>
                                {
                                    break 'outgoing;
                                }
                                Err(tungstenite::Error::ConnectionClosed) => {
                                    break 'el;
                                }
                                Err(e) => {
                                    error!("Websocket connection closed: {e}");
                                    break 'el;
                                }
                            };

                            let tungstenite::Message::Text(msg) = msg else {
                                continue;
                            };

                            let interface_packet: flat::InterfacePacket =
                                serde_json::from_str(&msg.to_string())?;

                            let built = build_packet(interface_packet, &mut builder)?;
                            rlbot_conn
                                .write_all(&built)
                                .context("couldn't send connectionsettings")?;
                        }
                    }
                    if event.is_writable() {
                        match websocket.flush() {
                            Ok(_) => { /* All pending data flushed */ }
                            Err(tungstenite::Error::Io(ref e))
                                if e.kind() == std::io::ErrorKind::WouldBlock =>
                            {
                                break; // kinda does nothing but whatever
                            }
                            Err(e) => Err(e)?,
                        }
                    }
                }
                _ => unreachable!(),
            }
        }
    }

    info!(
        "Scratch bot disconnected to core from port {}",
        rlbot_conn.local_addr().unwrap().port()
    );

    Ok(())
}
