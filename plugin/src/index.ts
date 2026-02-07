import RLBotExt, {
    blockConfigs,
    EXT_ID,
    type CustomBlockShape,
} from "./plugin";
(async function (Scratch) {
    "use strict";

    if (!Scratch.extensions.unsandboxed) {
        throw new Error("The RLBotV5 plugin needs to be unsandboxed");
    }

    let shapeBlocksMap: Record<CustomBlockShape, string[]> = {
        vector: [],
        rotator: [],
    };
    for (let cfg of blockConfigs) {
        if (typeof cfg === "string") continue;
        if (cfg.shape == undefined) continue;
        // @ts-ignore
        shapeBlocksMap[cfg.shape].push(EXT_ID + "_" + cfg.block.opcode);
    }

    let shapeBlockArgsMap: Record<CustomBlockShape, BlockArg[]> = {
        vector: [],
        rotator: [],
    };
    for (let cfg of blockConfigs) {
        if (typeof cfg === "string") continue;
        if (cfg.argShapes == undefined) continue;
        for (let arg in cfg.argShapes) {
            shapeBlockArgsMap[cfg.argShapes[arg]].push({
                // @ts-ignore
                block: EXT_ID + "_" + cfg.block.opcode,
                arg: arg,
            });
        }
    }

    RegisterCustomShapes(
        shapeBlocksMap.vector,
        shapeBlockArgsMap.vector,
        makeVectorShape,
    );
    RegisterCustomShapes(
        shapeBlocksMap.rotator,
        shapeBlockArgsMap.rotator,
        makeRotatorShape,
    );

    Scratch.extensions.register(new RLBotExt());
})(Scratch);

function makeVectorShape(width: number) {
    return `M${width - 7} 0
            L${width + 5} 20
            L${width - 7} 40
            H0 -6
            L7 20
            L-5 0
            H${width - 7}
            Z`
        .replaceAll("\n", "")
        .trim();
}

function makeRotatorShape(width: number) {
    let padding_left = 5;
    let padding_right = 5;

    let arrow_scale_x = 0.6;
    let arrow_shaft_inset = 6 * arrow_scale_x;
    let arrow_head_inset = 22 * arrow_scale_x;

    return `M${width + padding_right - arrow_shaft_inset} 20
            H${width + padding_right - arrow_head_inset}
            L${width + padding_right} 40
            H${arrow_shaft_inset - padding_left}
            V20
            H${arrow_head_inset - padding_left}
            L${-padding_left} 0
            H${width + padding_right - arrow_shaft_inset}
            V20
            Z`
        .replaceAll("\n", "")
        .trim();
}

type BlockArg = { block: string; arg: string };

// Logic stolen from https://github.com/SharkPool-SP/SharkPools-Extensions/blob/main/extension-code/JSON-Array.js
async function RegisterCustomShapes(
    blocks: string[],
    blockArgs: BlockArg[],
    makeShape: (width: number) => string,
) {
    if ((Scratch as any).gui == null) return;

    const Blockly: any = await (Scratch as any).gui.getBlockly();

    // Hijack blockly rendering
    const ogRender = Blockly.BlockSvg.prototype.render;
    Blockly.BlockSvg.prototype.render = function (...args: any[]) {
        // Call original rendering fn
        const data = ogRender.call(this, ...args);

        // If we're a block with a vector shape
        if (this.svgPath_ && blocks.includes(this.type)) {
            this.svgPath_.setAttribute(
                "transform",
                `scale(1, ${this.height / 40})`,
            );
            this.svgPath_.setAttribute("d", makeShape(this.width));
        }

        let matchingArgs = blockArgs
            .filter((x) => x.block === this.type)
            .map((x) => x.arg);

        // loop through arguments (inputs)
        this.inputList.forEach((input: any) => {
            if (matchingArgs.includes(input.name)) {
                const block = input.connection.targetBlock();
                if (block && block.type === "text" && block.svgPath_) {
                    block.svgPath_.setAttribute(
                        "transform",
                        `scale(1, ${block.height / 40})`,
                    );
                    block.svgPath_.setAttribute("d", makeShape(block.width));
                }
            }
        });

        return data;
    };
}
