use clap::Parser;
use color_eyre::eyre::{self, Context as _, ContextCompat as _};
use mio::Interest;
use rlbot::flat::{ConnectionSettings, InterfaceMessage, InterfacePacket};
use rlbot::{PacketParseError, flat};
use rlbot_flat::planus::{self, ReadAsRoot as _};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process;
use std::sync::Arc;
use std::{net::SocketAddr, thread};
use tracing::{error, info, warn};
use tungstenite::{HandshakeError, accept};

mod plugin_server;
mod runner;

const DEFAULT_BRIDGE_PORT: u16 = 23239;

fn validate_packetrate(s: &str) -> eyre::Result<usize> {
    let packetrate = s
        .parse::<usize>()
        .map_err(|_| eyre::eyre!("invalid packetrate"))?;
    if 120 % packetrate == 0 {
        Ok(packetrate)
    } else {
        Err(eyre::eyre!(
            "invalid packetrate `{packetrate}`, 120 is not divisible by {packetrate}"
        ))
    }
}

#[derive(Parser, Debug)]
struct Config {
    /// Packetrate for bots connected to this bridge
    #[arg(long, env = "RLBOT_SCRATCH_PACKETRATE", default_value_t = 60, value_parser = validate_packetrate)]
    packetrate: usize,

    /// Runs an SB3 file with the custom runtime. This will cause port to be
    /// a random value unless --force-port or RLBOT_SCRATCH_FORCE_PORT is set.
    #[arg(long, env = "RLBOT_SCRATCH_SB3_PATH")]
    sb3: Option<PathBuf>,

    /// Allows multiple clients to connect on passed port. This is on my default
    /// if sb3 is None, but off by default if it is Some(_).
    #[arg(long, env = "RLBOT_SCRATCH_FORCE_PORT")]
    multi_client: Option<u16>,
}

/// A WebSocket echo server
fn main() -> eyre::Result<()> {
    tracing_subscriber::fmt().init();
    let config = Arc::new(Config::parse());

    let bridge_port: u16 = match (&config.sb3, &config.multi_client) {
        (Some(_), None) => 0,
        (_, Some(port)) => *port,
        (None, None) => DEFAULT_BRIDGE_PORT,
    };

    // TODO: If port is used, find new one and tell deno about it
    let server =
        std::net::TcpListener::bind(SocketAddr::new("127.0.0.1".parse().unwrap(), bridge_port))
            .context(format!("Couldn't listen on port {bridge_port}"))?;

    let bridge_port = server.local_addr().unwrap().port();

    let runtime_thread = if let Some(path) = &config.sb3 {
        let path = path.clone();
        let log_error = config.multi_client.is_some();
        Some(thread::spawn(move || {
            runner::run_scratch_file(&path, bridge_port)
                .map_err(|e| eyre::eyre!(e))
                .context("Javascript runtime crashed, couldn't run scratch file")
                .map_err(|e| {
                    if log_error {
                        error!("{e}")
                    };
                    e
                })?;
            Ok(())
        }))
    } else {
        None
    };

    if let Some(rt) = runtime_thread
        && config.multi_client.is_none()
    {
        single_client(config, server, rt)
    } else {
        info!("Bridge listening on 127.0.0.1:{bridge_port}");
        multi_client(config, server)
    }
}

fn single_client<T>(
    config: Arc<Config>,
    server: TcpListener,
    runtime_thread: thread::JoinHandle<eyre::Result<T>>,
) -> eyre::Result<()> {
    info!("Running in single-client mode. Will exit when runtime does.");
    // We don't care about this thread, let it quit if this function does.
    thread::spawn(move || {
        let Some(Ok(stream)) = server.incoming().next() else {
            error!("Getting incoming connection failed");
            return;
        };
        stream.set_nonblocking(true).unwrap();
        let stream = mio::net::TcpStream::from_std(stream);
        let r = handle_client(config, stream);
        if let Err(e) = &r {
            error!("WS handler crashed: {e:?}");
        } else {
            info!("WS handler quit");
        };
    });
    runtime_thread.join().unwrap().map(|_| ())
}

fn multi_client(config: Arc<Config>, server: TcpListener) -> eyre::Result<()> {
    info!("Running in multi-client mode.");

    thread::spawn(|| {
        if let Err(e) = plugin_server::serve() {
            error!("Plugin server failed: {e}");
            process::exit(1);
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

        let config = config.clone();
        threads.push(thread::spawn(move || {
            let r = handle_client(config, stream);
            if let Err(e) = &r {
                error!("WS handler crashed: {e}");
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

fn handle_client(config: Arc<Config>, mut stream: mio::net::TcpStream) -> eyre::Result<()> {
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
    let tickskip = 120 / config.packetrate;

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
                                Err(tungstenite::Error::ConnectionClosed)
                                | Err(tungstenite::Error::Protocol(
                                    tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
                                )) => {
                                    info!("Websocket connection closed");
                                    break 'el;
                                }
                                Err(e) => {
                                    error!("Websocket connection closed: {e}");
                                    break 'el;
                                }
                            };

                            let tungstenite::Message::Text(msg) = msg else {
                                warn!("Expected text ws message");
                                continue;
                            };

                            let interface_packet: flat::InterfacePacket =
                                match serde_json::from_str(&msg.to_string()) {
                                    Ok(x) => x,
                                    Err(e) => {
                                        warn!(
                                            "Invalid InterfacePacket from client! {e}, {}",
                                            format!("invalid content {}", &msg.to_string())
                                        );
                                        continue;
                                    }
                                };

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
