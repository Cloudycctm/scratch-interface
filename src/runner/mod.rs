use deno_core::anyhow::Context;
use deno_core::error::AnyError;
use deno_core::url::Url;
use deno_core::{Extension, JsRuntime, OpState, RuntimeOptions, op2, v8};
use std::path::Path;
use std::sync::{Arc, LazyLock, RwLock};

static SB3_BUF: LazyLock<RwLock<Box<[u8]>>> = LazyLock::new(|| RwLock::new(Box::new([])));

#[op2]
#[arraybuffer]
fn op_load_sb3(_state: &mut OpState) -> Result<Box<[u8]>, deno_error::JsErrorBox> {
    Ok(SB3_BUF.read().unwrap().clone())
}

deno_core::extension!(
    sb3_loader,
    ops = [op_load_sb3],
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

pub fn run_scratch_file(_scratch_file: &Path) -> Result<(), AnyError> {
    // 1. Read the scratch file and load it into SB3_BUF
    let file_data = std::fs::read(_scratch_file).context("failed to read SB3 file")?;
    *SB3_BUF.write().unwrap() = file_data.into_boxed_slice();

    // 2. Load the JS source from your local file system at compile time
    let js_source = include_str!("../../runner/bundle.js");

    // 3. Initialize Extensions
    // Order matters: webidl and url are often dependencies for web and websocket
    let extensions: Vec<Extension> = vec![
        deno_webidl::deno_webidl::init(),
        deno_web::deno_web::init(
            Arc::new(deno_web::BlobStore::default()),
            None,
            Default::default(),
        ),
        deno_crypto::deno_crypto::init(None),
        // deno_net::deno_net::init(None, None),
        // deno_websocket::deno_websocket::init(),
        sb3_loader::init(),
        main::init(), //
                      // // // deno_fetch::deno_fetch::init(Default::default()),
                      //
    ];

    // 4. Create the Runtime
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

            let eval_fut = runtime.mod_evaluate(module_id);

            runtime.run_event_loop(Default::default()).await?;
            eval_fut.await?;

            Ok::<(), AnyError>(())
        })?;

    Ok(())
}
