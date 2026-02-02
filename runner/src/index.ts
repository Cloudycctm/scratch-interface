/// <reference path="../node_modules/@turbowarp/types/index.d.ts" />
/// <reference path="../node_modules/@types/node/index.d.ts" />

import VM from "scratch-vm";
import Storage from "scratch-storage";
import RLBotExt from "./plugin.ts";
import { once } from "node:events";

async function run_vm(raw_scratch_file: ArrayBuffer) {
    const vm = new VM();
    const storage = new Storage();

    vm.attachStorage(storage);
    vm.setTurboMode(true);

    // @ts-ignore needed for unsandboxed extensions
    globalThis.Scratch.vm = vm;
    // @ts-ignore this works
    vm.extensionManager.addBuiltinExtension("rlbotv5", RLBotExt);

    // @ts-ignore this also works
    vm.setFramerate(240);

    await vm.loadProject(raw_scratch_file);
    vm.start();
    vm.greenFlag();

    // @ts-ignore
    await once(vm, "PROJECT_RUN_STOP");
    vm.stopAll();
    vm.quit();
    return;
}

async function main() {
    // BridgeRuntime is a global provided by the custom deno-based runtime
    // @ts-ignore
    globalThis.BRIDGE_PORT = BridgeRuntime.getPort();
    await run_vm(BridgeRuntime.load());
}

await main();
