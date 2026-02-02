use deno_core::Extension;
use deno_core::JsBuffer;
use deno_core::OpState;
use deno_core::Resource;
use deno_core::ResourceId;
use deno_core::ascii_str_include;
use deno_core::op2;
use futures_util::stream::SplitSink;
use futures_util::stream::SplitStream;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tracing::warn;
use tungstenite::protocol::Message as WsMessage;

#[derive(Debug, thiserror::Error, deno_error::JsError)]
pub enum WebSocketError {
    #[class(type)]
    #[error(transparent)]
    Tungstenite(#[from] tungstenite::Error),
    #[class(inherit)]
    #[error(transparent)]
    Resource(#[from] deno_core::error::ResourceError),
    #[class(type)]
    #[error(transparent)]
    Http(#[from] tungstenite::http::Error),
    // #[class(generic)]
    // #[error("WebSocket error: {0}")]
    // Other(String),
}

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub struct WebSocketResource {
    stream: Arc<Mutex<SplitStream<WsStream>>>,
    sink: Arc<Mutex<SplitSink<WsStream, WsMessage>>>,
    closed: Arc<Mutex<bool>>,
}

impl Resource for WebSocketResource {
    fn name(&self) -> std::borrow::Cow<'_, str> {
        "webSocket".into()
    }

    fn close(self: Rc<Self>) {
        let closed = self.closed.clone();
        let sink = self.sink.clone();
        deno_core::unsync::spawn(async move {
            let mut closed_guard = closed.lock().await;
            if !*closed_guard {
                let mut sink_guard = sink.lock().await;
                let _ = sink_guard.close().await;
                *closed_guard = true;
            }
        });
    }
}

#[op2(async)]
#[smi]
pub async fn op_ws_create(
    state: Rc<RefCell<OpState>>,
    #[string] url: String,
    #[serde] protocols: Vec<String>,
) -> Result<ResourceId, WebSocketError> {
    if !protocols.is_empty() {
        warn!("op_ws_create: protocols argument not supported!")
    }

    let (ws_stream, _response) = tokio_tungstenite::connect_async(url).await?;

    let (ws_sink, ws_stream) = ws_stream.split();

    let resource = WebSocketResource {
        stream: Arc::new(Mutex::new(ws_stream)),
        sink: Arc::new(Mutex::new(ws_sink)),
        closed: Arc::new(Mutex::new(false)),
    };

    let rid = state.borrow_mut().resource_table.add(resource);

    Ok(rid)
}

#[op2(async)]
#[string]
pub async fn op_ws_get_protocol(
    _state: Rc<RefCell<OpState>>,
    #[smi] _rid: ResourceId,
) -> Result<String, WebSocketError> {
    Ok(String::new())
}

#[op2(async)]
pub async fn op_ws_send_text(
    state: Rc<RefCell<OpState>>,
    #[smi] rid: ResourceId,
    #[string] text: String,
) -> Result<(), WebSocketError> {
    let resource = state
        .borrow()
        .resource_table
        .get::<WebSocketResource>(rid)?;

    let mut sink = resource.sink.lock().await;
    sink.send(WsMessage::Text(text.into())).await?;
    Ok(())
}

#[op2(async)]
pub async fn op_ws_send_binary(
    state: Rc<RefCell<OpState>>,
    #[smi] rid: ResourceId,
    #[buffer] data: JsBuffer,
) -> Result<(), WebSocketError> {
    let data = data.to_vec();
    let resource = state
        .borrow()
        .resource_table
        .get::<WebSocketResource>(rid)?;

    let mut sink = resource.sink.lock().await;
    sink.send(WsMessage::Binary(data.into())).await?;
    Ok(())
}

#[op2(async)]
#[serde]
pub async fn op_ws_next_event(
    state: Rc<RefCell<OpState>>,
    #[smi] rid: ResourceId,
) -> Result<WsEvent, WebSocketError> {
    let resource = state
        .borrow()
        .resource_table
        .get::<WebSocketResource>(rid)?;

    let mut stream = resource.stream.lock().await;

    match stream.next().await {
        Some(Ok(msg)) => match msg {
            WsMessage::Text(text) => Ok(WsEvent::Message {
                data: MessageData::Text(text.to_string()),
            }),
            WsMessage::Binary(data) => Ok(WsEvent::Message {
                data: MessageData::Binary(data.to_vec()),
            }),
            WsMessage::Ping(_) => Ok(WsEvent::Ping),
            WsMessage::Pong(_) => Ok(WsEvent::Pong),
            WsMessage::Close(close_frame) => {
                let (code, reason) = close_frame
                    .map(|f| (f.code.into(), f.reason.to_string()))
                    .unwrap_or((1005, String::new()));

                let mut closed = resource.closed.lock().await;
                *closed = true;

                Ok(WsEvent::Close { code, reason })
            }
            WsMessage::Frame(_) => Ok(WsEvent::Ping),
        },
        Some(Err(e)) => {
            let mut closed = resource.closed.lock().await;
            *closed = true;
            Ok(WsEvent::Error {
                message: e.to_string(),
            })
        }
        None => {
            let mut closed = resource.closed.lock().await;
            *closed = true;
            Ok(WsEvent::Close {
                code: 1006,
                reason: String::new(),
            })
        }
    }
}

#[op2(async)]
pub async fn op_ws_close(
    state: Rc<RefCell<OpState>>,
    #[smi] rid: ResourceId,
    #[smi] _code: u16,
    #[string] _reason: String,
) -> Result<(), WebSocketError> {
    let resource = state
        .borrow()
        .resource_table
        .get::<WebSocketResource>(rid)?;

    let mut closed = resource.closed.lock().await;
    if *closed {
        return Ok(());
    }

    let mut sink = resource.sink.lock().await;

    // Sink doesn't seem to support close_frames
    // let close_frame = if code == 1005 || code == 1006 {
    //     None
    // } else {
    //     Some(CloseFrame {
    //         code: CloseCode::from(code),
    //         reason: reason.into(),
    //     })
    // };

    sink.close().await?;
    *closed = true;

    Ok(())
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WsEvent {
    Message { data: MessageData },
    Close { code: u16, reason: String },
    Ping,
    Pong,
    Error { message: String },
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum MessageData {
    Text(String),
    Binary(Vec<u8>),
}

pub fn init() -> Extension {
    const OPS: &[deno_core::OpDecl] = &[
        op_ws_create(),
        op_ws_get_protocol(),
        op_ws_send_text(),
        op_ws_send_binary(),
        op_ws_next_event(),
        op_ws_close(),
    ];

    const JS_FILES: &[deno_core::ExtensionFileSource] = &[deno_core::ExtensionFileSource::new(
        "ext:websocket/websocket.js",
        ascii_str_include!("websocket.js"),
    )];

    Extension {
        name: "websocket",
        ops: std::borrow::Cow::Borrowed(OPS),
        op_state_fn: None,
        middleware_fn: None,
        js_files: std::borrow::Cow::Borrowed(&[]),
        global_template_middleware: None,
        global_object_middleware: None,
        esm_files: std::borrow::Cow::Borrowed(JS_FILES),
        esm_entry_point: Some("ext:websocket/websocket.js"),
        deps: &[],
        lazy_loaded_esm_files: std::borrow::Cow::Borrowed(&[]),
        objects: Default::default(),
        external_references: Default::default(),
        needs_lazy_init: false,
        enabled: true,
    }
}
