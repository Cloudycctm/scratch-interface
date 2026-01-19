use std::path::Path;

use color_eyre::eyre;
use rustyscript::{Module, Runtime};

pub fn run_scratch_file(sb3_path: &Path) -> eyre::Result<()> {
    let module = Module::new("test.js", include_str!("../../runner/bundle.js"));

    let value: usize = Runtime::execute_module(&module, vec![], Default::default(), &("test"))?;

    assert_eq!(value, 2);

    Ok(())
}
