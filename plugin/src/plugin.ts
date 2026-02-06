import type {
    ControllableTeamInfo,
    ControllerState,
    CorePacket,
    GamePacket,
    InterfacePacket,
    Rotator,
    Vector3,
} from "./rlbot";
// @ts-ignore, bun handles this, see build.rs
import logo_svg from "../logo.svg" with { type: "text" };
const logo_uri = `data:image/svg+xml;base64,${btoa(logo_svg)}`;

export type CustomBlockShape = "vector";

type ReturnTypes = void | string | boolean | number | Promise<ReturnTypes>;

export const blockConfigs: (
    | {
          block: Scratch.Block;
          shape?: CustomBlockShape;
          argShapes?: Record<string, CustomBlockShape>;
          fn: (this: RLBotExt, args: any) => ReturnTypes;
      }
    | string
)[] = [
    {
        block: {
            opcode: "connect",
            blockType: Scratch.BlockType.COMMAND,
            arguments: {
                PORT: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 23239,
                },
            },
            text: "connect to RLBot scratch bridge [PORT]",
        },
        fn(args) {
            // @ts-ignore load port from headless runtime if we're in it
            args.PORT = globalThis.BRIDGE_PORT ?? args.PORT;

            // @ts-ignore
            if (globalThis.Deno == null) {
                console.log(
                    `Connecting to RLBot scratch bridge on port ${args.PORT}`,
                );
            }

            if (this.ws) {
                this.ws.close();
            }
            this.ws = new WebSocket(`ws://127.0.0.1:${args.PORT}`);
            this.ws.onopen = () => {
                console.log("Connected to RLBot scratch bridge");
                this.connectResolveList.forEach((resolve) => resolve());
                this.connectResolveList = [];
            };
            this.ws.onclose = () => {
                this.disconnectResolveList.forEach((resolve) => resolve());
                this.disconnectResolveList = [];
            };

            let resolver: () => void;
            let promise = new Promise<void>((resolve, _) => {
                resolver = resolve;
            });

            this.ws.onmessage = (event: any) => {
                let json_str = event.data;
                // TODO: Store all of this in this class and also call new event "tick"
                let packet: CorePacket = JSON.parse(json_str);

                let gamepacket = (packet.message as { GamePacket: GamePacket })
                    .GamePacket;

                if (gamepacket != null) {
                    this.lastGamePacket = gamepacket;
                    // @ts-ignore; the types are for unsandboxed extension, we're not
                    Scratch.vm.runtime.startHats("rlbotv5_onTick");
                }

                let controllerteaminfo = (
                    packet.message as {
                        ControllableTeamInfo: ControllableTeamInfo;
                    }
                ).ControllableTeamInfo;
                if (controllerteaminfo) {
                    this.ourTeam = controllerteaminfo;
                    resolver();
                }
            };
            return promise;
        },
    },
    {
        block: {
            opcode: "onTick",
            blockType: Scratch.BlockType.EVENT,
            text: "every game tick",
            isEdgeActivated: false,
            shouldRestartExistingThreads: false,
        },
        fn(_) {},
    },
    {
        block: {
            opcode: "initComplete",
            blockType: Scratch.BlockType.COMMAND,
            text: "send InitComplete",
        },
        fn(args) {
            let packet: InterfacePacket = {
                message: { InitComplete: {} },
            };

            if (this.ws?.readyState == WebSocket.CONNECTING) {
                let promise = new Promise<void>((resolve) => {
                    this.connectResolveList.push(resolve);
                });
                return promise;
            }

            this.ws?.send(JSON.stringify(packet));
        },
    },
    {
        block: {
            opcode: "sendController",
            blockType: Scratch.BlockType.COMMAND,
            text: "send Controller Inputs",
        },
        fn(args) {
            if (this.ourTeam == null) {
                console.log("Refusing to send controller, ourTeam undefined");
                return;
            }
            let packet: InterfacePacket = {
                message: {
                    PlayerInput: {
                        player_index: this.ourTeam?.controllables[0]
                            .index as number,
                        controller_state: this.controller,
                    },
                },
            };
            this.ws?.send(JSON.stringify(packet));
        },
    },
    {
        block: {
            opcode: "waitDisconnect",
            blockType: Scratch.BlockType.COMMAND,
            text: "wait for disconnect",
        },
        fn(_) {
            let promise = new Promise<void>((resolve) => {
                this.disconnectResolveList.push(resolve);
            });
            return promise;
        },
    },
    {
        block: {
            opcode: "setFramerate",
            blockType: Scratch.BlockType.COMMAND,
            text: "set max tickrate to [VALUE]",
            arguments: {
                VALUE: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 60,
                },
            },
        },
        fn(args) {
            let n = +args.VALUE;
            // @ts-ignore works since we're not sandboxed
            Scratch.vm.setFramerate(n);
        },
    },
    "Controller",
    {
        block: {
            opcode: "setThrottle",
            blockType: Scratch.BlockType.COMMAND,
            text: "set throttle to [VALUE]",
            arguments: {
                VALUE: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
            },
        },
        fn(args) {
            this.controller.throttle = Number(args.VALUE);
        },
    },
    {
        block: {
            opcode: "setSteer",
            blockType: Scratch.BlockType.COMMAND,
            text: "set steer to [VALUE]",
            arguments: {
                VALUE: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
            },
        },
        fn(args) {
            this.controller.steer = Number(args.VALUE);
        },
    },
    {
        block: {
            opcode: "setPitch",
            blockType: Scratch.BlockType.COMMAND,
            text: "set pitch to [VALUE]",
            arguments: {
                VALUE: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
            },
        },
        fn(args) {
            this.controller.pitch = Number(args.VALUE);
        },
    },
    {
        block: {
            opcode: "setYaw",
            blockType: Scratch.BlockType.COMMAND,
            text: "set yaw to [VALUE]",
            arguments: {
                VALUE: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
            },
        },
        fn(args) {
            this.controller.yaw = Number(args.VALUE);
        },
    },
    {
        block: {
            opcode: "setRoll",
            blockType: Scratch.BlockType.COMMAND,
            text: "set roll to [VALUE]",
            arguments: {
                VALUE: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
            },
        },
        fn(args) {
            this.controller.roll = Number(args.VALUE);
        },
    },
    {
        block: {
            opcode: "setJump",
            blockType: Scratch.BlockType.COMMAND,
            text: "set jump to [VALUE]",
            arguments: {
                VALUE: {
                    type: Scratch.ArgumentType.BOOLEAN,
                },
            },
        },
        fn(args) {
            this.controller.jump = Boolean(args.VALUE);
        },
    },
    {
        block: {
            opcode: "setBoost",
            blockType: Scratch.BlockType.COMMAND,
            text: "set boost to [VALUE]",
            arguments: {
                VALUE: {
                    type: Scratch.ArgumentType.BOOLEAN,
                },
            },
        },
        fn(args) {
            this.controller.boost = Boolean(args.VALUE);
        },
    },
    {
        block: {
            opcode: "setHandbrake",
            blockType: Scratch.BlockType.COMMAND,
            text: "set handbrake to [VALUE]",
            arguments: {
                VALUE: {
                    type: Scratch.ArgumentType.BOOLEAN,
                },
            },
        },
        fn(args) {
            this.controller.handbrake = Boolean(args.VALUE);
        },
    },
    "Vector/Rotator ops",
    {
        block: {
            opcode: "getComponent",
            blockType: Scratch.BlockType.REPORTER,
            text: "[COMPONENT] of [VECTOR]",
            arguments: {
                COMPONENT: {
                    type: Scratch.ArgumentType.STRING,
                    menu: "XYZ",
                },
                VECTOR: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
            },
        },
        argShapes: { VECTOR: "vector" },
        fn(args) {
            return parseVector(args.VECTOR)[args.COMPONENT as "x" | "y" | "z"];
        },
    },
    {
        block: {
            opcode: "getComponentRotator",
            blockType: Scratch.BlockType.REPORTER,
            text: "[COMPONENT] of [ROTATOR]",
            arguments: {
                COMPONENT: {
                    type: Scratch.ArgumentType.STRING,
                    menu: "PYR",
                },
                ROTATOR: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
            },
        },
        // todo: add custom shape for rotators
        argShapes: { ROTATOR: "vector" },
        fn(args) {
            return parseRotator(args.ROTATOR)[
                args.COMPONENT as "pitch" | "yaw" | "roll"
            ];
        },
    },
    "GamePacket",
    {
        block: {
            opcode: "gamePacketBallLocation",
            blockType: Scratch.BlockType.REPORTER,
            text: "ball location",
        },
        shape: "vector",
        fn(_) {
            return stringifyVector(
                this.lastGamePacket?.balls[0].physics.location ?? {
                    x: 0,
                    y: 0,
                    z: 0,
                },
            );
        },
    },
    {
        block: {
            opcode: "gamePacketBallVelocity",
            blockType: Scratch.BlockType.REPORTER,
            text: "ball velocity",
        },
        shape: "vector",
        fn(_) {
            return stringifyVector(
                this.lastGamePacket?.balls[0].physics.velocity ?? {
                    x: 0,
                    y: 0,
                    z: 0,
                },
            );
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerPosition",
            blockType: Scratch.BlockType.REPORTER,
            text: "position of player [ID]",
            arguments: {
                ID: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args: any) {
            if (!this.lastGamePacket) return "null";
            let vec = this.lastGamePacket.players.find(
                (p) => p.player_id == args.ID,
            )?.physics?.location;
            return vec != undefined ? stringifyVector(vec) : "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerRotation",
            blockType: Scratch.BlockType.REPORTER,
            text: "rotation of player [ID]",
            arguments: {
                ID: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        // todo: custom shape this
        shape: "vector",
        fn(args: any) {
            if (!this.lastGamePacket) return "null";
            let rot = this.lastGamePacket.players.find(
                (p) => p.player_id == args.ID,
            )?.physics?.rotation;
            return rot != undefined
                ? // use same internal rep
                  stringifyVector({
                      x: rot?.pitch,
                      y: rot?.yaw,
                      z: rot?.roll,
                  })
                : "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerIdTeammate",
            blockType: Scratch.BlockType.REPORTER,
            text: "player id of teammate [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        fn(args: any) {
            if (!this.lastGamePacket) return "null";
            return (
                this.lastGamePacket.players
                    .filter((player) => player.team === this.ourTeam?.team)
                    .map((player) => player.player_id)[args?.INDEX ?? 0] ??
                "null"
            );
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerIdOpponent",
            blockType: Scratch.BlockType.REPORTER,
            text: "player id of opponent [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        fn(args: any) {
            if (!this.lastGamePacket) return "null";
            return (
                this.lastGamePacket.players
                    .filter((player) => player.team !== this.ourTeam?.team)
                    .map((player) => player.player_id)[args?.INDEX ?? 0] ??
                "null"
            );
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerIdOurs",
            blockType: Scratch.BlockType.REPORTER,
            text: "our player id",
        },
        fn(args: any) {
            if (!this.ourTeam) return "null";
            return this.ourTeam.controllables[0].identifier;
        },
    },
    "Match info",
    {
        block: {
            opcode: "matchInfoSecondsElapsed",
            blockType: Scratch.BlockType.REPORTER,
            text: "seconds elapsed",
        },
        fn(args) {
            return this.lastGamePacket?.match_info.seconds_elapsed ?? 0;
        },
    },
    "Boolean values",
    {
        block: {
            opcode: "trueValue",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "TRUE",
        },
        fn(args) {
            return true;
        },
    },
    {
        block: {
            opcode: "falseValue",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "FALSE",
        },
        fn(args) {
            return false;
        },
    },
];

// [0,0,0] to Vector3
function parseVector(s: string): Vector3 {
    let parsed = JSON.parse(s);
    if (Array.isArray(parsed) && parsed.length === 3) {
        return {
            x: +parsed[0],
            y: +parsed[1],
            z: +parsed[2],
        };
    }
    throw new Error(`Invalid vector string: ${JSON.stringify(parsed)}`);
}

// Vector3 to [0,0,0]
function stringifyVector(v: Vector3): string {
    return JSON.stringify([v.x, v.y, v.z]);
}

// [0,0,0] to Rotator
function parseRotator(s: string): Rotator {
    let parsed = JSON.parse(s);
    if (Array.isArray(parsed) && parsed.length === 3) {
        return {
            pitch: +parsed[0],
            yaw: +parsed[1],
            roll: +parsed[2],
        };
    }
    throw new Error(`Invalid rotator string: ${JSON.stringify(parsed)}`);
}

// Rotator to [0,0,0]
function stringifyRotator(r: Rotator): string {
    return JSON.stringify([r.pitch, r.yaw, r.roll]);
}

// Needs to be changed in case of breaking changes, see
// https://docs.turbowarp.org/development/extensions/compatibility
export const EXT_ID = "rlbotv5";

class RLBotExt implements Scratch.Extension {
    ws: undefined | WebSocket;
    ourTeam: undefined | ControllableTeamInfo;
    lastGamePacket: undefined | GamePacket;
    controller: ControllerState = {
        throttle: 0,
        steer: 0,
        pitch: 0,
        yaw: 0,
        roll: 0,
        jump: false,
        boost: false,
        handbrake: false,
        use_item: false,
    };
    disconnectResolveList: ((_: void) => void)[] = [];
    connectResolveList: ((_: void) => void)[] = [];

    constructor() {
        // Missing in d.ts, but exists in unsandboxed exts
        (Scratch as any).vm.runtime.addListener("PROJECT_STOP_ALL", () => {
            this.ws?.close();
        });
    }

    getInfo(): Scratch.Info {
        return {
            id: EXT_ID,
            name: "RLBot v5",
            menuIconURI: logo_uri,
            color1: "#0a8600",
            blocks: blockConfigs.map((cfg) => {
                if (typeof cfg === "string")
                    return {
                        // @ts-ignore Missing in d.ts, but exists
                        blockType: Scratch.BlockType.LABEL,
                        text: cfg,
                    } as Scratch.Block;
                return cfg.block;
            }),
            menus: {
                XYZ: ["x", "y", "z"],
                PYR: ["pitch", "yaw", "roll"],
            },
        };
    }
}

for (let cfg of blockConfigs) {
    if (typeof cfg === "string") continue;
    if (!("opcode" in cfg.block)) continue;
    (RLBotExt.prototype as any)[cfg.block.opcode] = cfg.fn;
}

export default RLBotExt;
