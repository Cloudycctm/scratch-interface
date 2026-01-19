import RLBotExt from "./plugin";
(function (Scratch) {
    "use strict";

    if (!Scratch.extensions.unsandboxed) {
        throw new Error("The RLBotV5 plugin needs to be unsandboxed");
    }

    Scratch.extensions.register(new RLBotExt());
})(Scratch);
