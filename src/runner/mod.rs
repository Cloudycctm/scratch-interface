use deno_core::anyhow::Context;
use deno_core::error::AnyError;
use deno_core::url::Url;
use deno_core::{Extension, JsRuntime, OpState, RuntimeOptions, op2};
use std::path::Path;
use std::sync::{Arc, LazyLock, RwLock};

// Homemade WebSocket implementation that works somehow
// not using deno_websocket because of huge bloat from its dependencies
mod ext_websocket;

static SB3_BUF: LazyLock<RwLock<Box<[u8]>>> = LazyLock::new(|| RwLock::new(Box::new([])));

#[op2]
#[arraybuffer]
fn op_load_sb3(_state: &mut OpState) -> Result<Box<[u8]>, deno_error::JsErrorBox> {
    Ok(SB3_BUF.read().unwrap().clone())
}

static BRIDGE_PORT: LazyLock<RwLock<u16>> = LazyLock::new(|| RwLock::new(0));

#[op2(fast)]
fn op_get_port(_state: &mut OpState) -> Result<u16, deno_error::JsErrorBox> {
    Ok(BRIDGE_PORT.read().unwrap().clone())
}

deno_core::extension!(
    sb3_loader,
    ops = [op_load_sb3, op_get_port],
    esm_entry_point = "ext:sb3_loader/sb3_loader.js",
    esm = [ dir "src/runner", "sb3_loader.js" ],
    docs = "Extension for loading sb3 files",
);

deno_core::extension!(
  main,
  // ops = [],
  esm_entry_point = "ext:main/esm_imports.js",
  esm = [ dir "src/runner", "esm_imports.js" ],
  docs = "Loads all of the esm stuff"
);

pub fn run_scratch_file(scratch_file: &Path, port: u16) -> Result<(), AnyError> {
    let file_data = std::fs::read(scratch_file).context("failed to read SB3 file")?;
    *SB3_BUF.write().unwrap() = file_data.into_boxed_slice();
    *BRIDGE_PORT.write().unwrap() = port;

    let js_source = include_str!("../../runner/bundle.js");

    let extensions: Vec<Extension> = vec![
        deno_webidl::deno_webidl::init(),
        deno_web::deno_web::init(
            Arc::new(deno_web::BlobStore::default()),
            None,
            Default::default(),
        ),
        deno_crypto::deno_crypto::init(None),
        main::init(), //
        ext_websocket::init(),
        sb3_loader::init(),
    ];

    let mut runtime = JsRuntime::new(RuntimeOptions {
        extensions,
        ..Default::default()
    });

    // Spawn single-threaded tokio runtime
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async {
            let module_id = runtime
                .load_main_es_module_from_code(&"file://runtime.js".parse::<Url>()?, js_source)
                .await?;

            let mut eval_fut = runtime.mod_evaluate(module_id);

            runtime
                .with_event_loop_promise(&mut eval_fut, Default::default())
                .await?;

            // This makes sure we catch errors when the js crashes.
            runtime.run_event_loop(Default::default()).await?;

            Ok::<(), AnyError>(())
        })?;

    Ok(())
}
