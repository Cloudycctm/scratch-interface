//! TurboWarp only supports loading plugins from localhost:8000
//! (this is hardcoded behaviour in turbowarp, which sucks but whatever)
//! TODO: Look into solutions with turbowarp maintainers
//! In development (outside of the custom runtime) we therefor need to serve
//! the runnet/bundle.js file so TW can load the RLBot ext.

use std::str::FromStr;

use color_eyre::eyre::{self, OptionExt};
use tiny_http::{Header, Method, Response, Server, StatusCode};
use tracing::info;

fn get_bundle() -> String {
    if cfg!(not(debug_assertions)) {
        include_str!("../plugin/bundle.js").to_string()
    } else {
        std::fs::read_to_string("plugin/bundle.js").expect("Failed to read bundle.js")
    }
}

pub fn serve() -> eyre::Result<()> {
    let server = Server::http("0.0.0.0:8000")
        .ok()
        .ok_or_eyre("Couldn't listen to port 8000 (forced due to tw constraints)")?;

    info!("Plugin server listening on port 8000");

    for request in server.incoming_requests() {
        match (request.method(), request.url()) {
            (Method::Get, "/bundle.js") => {
                let res = Response::from_string(get_bundle())
                    .with_header(Header::from_str("Access-Control-Allow-Origin: *").unwrap())
                    .with_header(
                        Header::from_str("Content-Type: text/javascript; charset=UTF-8").unwrap(),
                    );
                request.respond(res)?;
                info!("Served plugin bundle");
            }
            _ => {
                request.respond(Response::new_empty(StatusCode(404)))?;
            }
        };
    }

    Ok(())
}
