globalThis.BridgeRuntime = {
    load: () => Deno.core.ops.op_load_sb3(),
    getPort: () => Deno.core.ops.op_get_port(),
};
