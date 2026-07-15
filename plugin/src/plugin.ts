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

export type CustomBlockShape = "vector" | "rotator";

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
                    Scratch.vm.runtime.startHats(`${EXT_ID}_onTick`);
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
    "Math",
    {
        block: {
            opcode: "atan2",
            blockType: Scratch.BlockType.REPORTER,
            text: "atan2 y [Y] x [X]",
            arguments: {
                Y: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
                X: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 1,
                },
            },
        },
        fn(args) {
            return Math.atan2(
                Number(args.Y),
                Number(args.X),
            );
        },
    },
    {
        block: {
            opcode: "min",
            blockType: Scratch.BlockType.REPORTER,
            text: "minimum of [A] and [B]",
            arguments: {
                A: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
                B: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
            },
        },
        fn(args) {
            return Math.min(
                Number(args.A),
                Number(args.B),
            );
        },
    },
    {
        block: {
            opcode: "max",
            blockType: Scratch.BlockType.REPORTER,
            text: "maximum of [A] and [B]",
            arguments: {
                A: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
                B: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
            },
        },
        fn(args) {
            return Math.max(
                Number(args.A),
                Number(args.B),
            );
        },
    },
    {
        block: {
            opcode: "clamp",
            blockType: Scratch.BlockType.REPORTER,
            text: "clamp [VALUE] between [MIN] and [MAX]",
            arguments: {
                VALUE: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
                MIN: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: -1,
                },
                MAX: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 1,
                },
            },
        },
        fn(args) {
            const value = Number(args.VALUE);
            const minimum = Number(args.MIN);
            const maximum = Number(args.MAX);

            const lowerBound = Math.min(minimum, maximum);
            const upperBound = Math.max(minimum, maximum);

            return Math.min(
                Math.max(value, lowerBound),
                upperBound,
            );
        },
    },
    "Vector/Rotator ops",
    {
        block: {
            opcode: "vectorCreate",
            blockType: Scratch.BlockType.REPORTER,
            text: "vector x [X] y [Y] z [Z]",
            arguments: {
                X: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
                Y: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
                Z: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args) {
            return stringifyVector({
                x: Number(args.X),
                y: Number(args.Y),
                z: Number(args.Z),
            });
        },
    },
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
        argShapes: { ROTATOR: "rotator" },
        fn(args) {
            return parseRotator(args.ROTATOR)[
                args.COMPONENT as "pitch" | "yaw" | "roll"
            ];
        },
    },
    {
        block: {
            opcode: "vectorAdd",
            blockType: Scratch.BlockType.REPORTER,
            text: "[A] + [B]",
            arguments: {
                A: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
                B: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
            },
        },
        argShapes: { A: "vector", B: "vector" },
        shape: "vector",
        fn(args) {
            let a = parseVector(args.A);
            let b = parseVector(args.B);
            return stringifyVector({
                x: a.x + b.x,
                y: a.y + b.y,
                z: a.z + b.z,
            });
        },
    },
    {
        block: {
            opcode: "vectorSub",
            blockType: Scratch.BlockType.REPORTER,
            text: "[A] - [B]",
            arguments: {
                A: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
                B: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
            },
        },
        argShapes: { A: "vector", B: "vector" },
        shape: "vector",
        fn(args) {
            let a = parseVector(args.A);
            let b = parseVector(args.B);
            return stringifyVector({
                x: a.x - b.x,
                y: a.y - b.y,
                z: a.z - b.z,
            });
        },
    },
    {
        block: {
            opcode: "vectorScale",
            blockType: Scratch.BlockType.REPORTER,
            text: "[A] * [S]",
            arguments: {
                A: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
                S: {
                    type: Scratch.ArgumentType.NUMBER,
                    defaultValue: 1,
                },
            },
        },
        argShapes: { A: "vector" },
        shape: "vector",
        fn(args) {
            let a = parseVector(args.A);
            let s = Number(args.S);
            return stringifyVector({
                x: a.x * s,
                y: a.y * s,
                z: a.z * s,
            });
        },
    },
    {
        block: {
            opcode: "vectorDot",
            blockType: Scratch.BlockType.REPORTER,
            text: "dot [A] [B]",
            arguments: {
                A: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
                B: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
            },
        },
        argShapes: { A: "vector", B: "vector" },
        fn(args) {
            let a = parseVector(args.A);
            let b = parseVector(args.B);
            return a.x * b.x + a.y * b.y + a.z * b.z;
        },
    },
    {
        block: {
            opcode: "vectorCross",
            blockType: Scratch.BlockType.REPORTER,
            text: "cross [A] [B]",
            arguments: {
                A: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
                B: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
            },
        },
        argShapes: { A: "vector", B: "vector" },
        shape: "vector",
        fn(args) {
            let a = parseVector(args.A);
            let b = parseVector(args.B);
            return stringifyVector({
                x: a.y * b.z - a.z * b.y,
                y: a.z * b.x - a.x * b.z,
                z: a.x * b.y - a.y * b.x,
            });
        },
    },
    {
        block: {
            opcode: "vectorMagnitude",
            blockType: Scratch.BlockType.REPORTER,
            text: "magnitude [A]",
            arguments: {
                A: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
            },
        },
        argShapes: { A: "vector" },
        fn(args) {
            let a = parseVector(args.A);
            return Math.hypot(a.x, a.y, a.z);
        },
    },
    {
        block: {
            opcode: "vectorNormalize",
            blockType: Scratch.BlockType.REPORTER,
            text: "normalize [A]",
            arguments: {
                A: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
            },
        },
        argShapes: { A: "vector" },
        shape: "vector",
        fn(args) {
            let a = parseVector(args.A);
            let mag = Math.hypot(a.x, a.y, a.z);
            if (mag === 0) return stringifyVector({ x: 0, y: 0, z: 0 });
            return stringifyVector({
                x: a.x / mag,
                y: a.y / mag,
                z: a.z / mag,
            });
        },
    },
    {
        block: {
            opcode: "vectorDistance",
            blockType: Scratch.BlockType.REPORTER,
            text: "distance [A] [B]",
            arguments: {
                A: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
                B: {
                    type: Scratch.ArgumentType.STRING,
                    defaultValue: "[0,0,0]",
                },
            },
        },
        argShapes: { A: "vector", B: "vector" },
        fn(args) {
            let a = parseVector(args.A);
            let b = parseVector(args.B);
            return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        },
    },
    "GamePacket - Counts",
    {
        block: {
            opcode: "gamePacketPlayersCount",
            blockType: Scratch.BlockType.REPORTER,
            text: "players count",
        },
        fn(_) {
            return this.lastGamePacket?.players.length ?? 0;
        },
    },
    {
        block: {
            opcode: "gamePacketBallsCount",
            blockType: Scratch.BlockType.REPORTER,
            text: "balls count",
        },
        fn(_) {
            return this.lastGamePacket?.balls.length ?? 0;
        },
    },
    {
        block: {
            opcode: "gamePacketBoostPadsCount",
            blockType: Scratch.BlockType.REPORTER,
            text: "boost pads count",
        },
        fn(_) {
            return this.lastGamePacket?.boost_pads.length ?? 0;
        },
    },
    "GamePacket - Balls",
    {
        block: {
            opcode: "gamePacketBallLocation",
            blockType: Scratch.BlockType.REPORTER,
            text: "ball [INDEX] location",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args) {
            let ball = this.lastGamePacket?.balls?.[args?.INDEX ?? 0];
            if (!ball) return "null";
            return stringifyVector(ball.physics.location);
        },
    },
    {
        block: {
            opcode: "gamePacketBallRotation",
            blockType: Scratch.BlockType.REPORTER,
            text: "ball [INDEX] rotation",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "rotator",
        fn(args) {
            let ball = this.lastGamePacket?.balls?.[args?.INDEX ?? 0];
            if (!ball) return "null";
            return stringifyVector({
                x: ball.physics.rotation.pitch,
                y: ball.physics.rotation.yaw,
                z: ball.physics.rotation.roll,
            });
        },
    },
    {
        block: {
            opcode: "gamePacketBallVelocity",
            blockType: Scratch.BlockType.REPORTER,
            text: "ball [INDEX] velocity",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args) {
            let ball = this.lastGamePacket?.balls?.[args?.INDEX ?? 0];
            if (!ball) return "null";
            return stringifyVector(ball.physics.velocity);
        },
    },
    {
        block: {
            opcode: "gamePacketBallAngularVelocity",
            blockType: Scratch.BlockType.REPORTER,
            text: "ball [INDEX] angular velocity",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args) {
            let ball = this.lastGamePacket?.balls?.[args?.INDEX ?? 0];
            if (!ball) return "null";
            return stringifyVector(ball.physics.angular_velocity);
        },
    },
    {
        block: {
            opcode: "gamePacketBallShapeType",
            blockType: Scratch.BlockType.REPORTER,
            text: "ball [INDEX] shape type",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        fn(args) {
            let ball = this.lastGamePacket?.balls?.[args?.INDEX ?? 0];
            if (!ball) return "null";
            if ("BoxShape" in ball.shape) return "box";
            if ("SphereShape" in ball.shape) return "sphere";
            if ("CylinderShape" in ball.shape) return "cylinder";
            return "null";
        },
    },
    {
        block: {
            opcode: "gamePacketBallShapeDim",
            blockType: Scratch.BlockType.REPORTER,
            text: "ball [INDEX] shape [DIM]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
                DIM: {
                    type: Scratch.ArgumentType.STRING,
                    menu: "BALL_SHAPE_DIM",
                },
            },
        },
        fn(args) {
            let ball = this.lastGamePacket?.balls?.[args?.INDEX ?? 0];
            if (!ball) return 0;
            if ("BoxShape" in ball.shape) {
                let box = ball.shape.BoxShape;
                return box[args.DIM as "length" | "width" | "height"] ?? 0;
            }
            if ("SphereShape" in ball.shape) {
                let sphere = ball.shape.SphereShape;
                return args.DIM === "diameter" ? sphere.diameter : 0;
            }
            if ("CylinderShape" in ball.shape) {
                let cyl = ball.shape.CylinderShape;
                return args.DIM === "height"
                    ? cyl.height
                    : args.DIM === "diameter"
                      ? cyl.diameter
                      : 0;
            }
            return 0;
        },
    },
    "GamePacket - Players",
    {
        block: {
            opcode: "gamePacketPlayerPosition",
            blockType: Scratch.BlockType.REPORTER,
            text: "position of player [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            let vec = player?.physics?.location;
            return vec != undefined ? stringifyVector(vec) : "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerRotation",
            blockType: Scratch.BlockType.REPORTER,
            text: "rotation of player [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "rotator",
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            let rot = player?.physics?.rotation;
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
            opcode: "gamePacketPlayerVelocity",
            blockType: Scratch.BlockType.REPORTER,
            text: "velocity of player [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            let vec = player?.physics?.velocity;
            return vec != undefined ? stringifyVector(vec) : "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerAngularVelocity",
            blockType: Scratch.BlockType.REPORTER,
            text: "angular velocity of player [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            let vec = player?.physics?.angular_velocity;
            return vec != undefined ? stringifyVector(vec) : "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerHitbox",
            blockType: Scratch.BlockType.REPORTER,
            text: "hitbox [DIM] of player [INDEX]",
            arguments: {
                DIM: {
                    type: Scratch.ArgumentType.STRING,
                    menu: "HITBOX_DIM",
                },
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            let hitbox = player?.hitbox;
            if (!hitbox) return 0;
            return hitbox[args.DIM as "length" | "width" | "height"] ?? 0;
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerHitboxOffset",
            blockType: Scratch.BlockType.REPORTER,
            text: "hitbox offset of player [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            let vec = player?.hitbox_offset;
            return vec != undefined ? stringifyVector(vec) : "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerDodgeDir",
            blockType: Scratch.BlockType.REPORTER,
            text: "dodge direction of player [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            let dir = player?.dodge_dir;
            return dir != undefined
                ? stringifyVector({ x: dir.x, y: dir.y, z: 0 })
                : "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerLatestTouchLocation",
            blockType: Scratch.BlockType.REPORTER,
            text: "latest touch location of player [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            let loc = player?.latest_touch?.location;
            return loc != undefined ? stringifyVector(loc) : "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerLatestTouchNormal",
            blockType: Scratch.BlockType.REPORTER,
            text: "latest touch normal of player [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        shape: "vector",
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            let normal = player?.latest_touch?.normal;
            return normal != undefined ? stringifyVector(normal) : "null";
        },
    },
    {
        block: {
            opcode: "gamePacketBoolean",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "game [FIELD] [INDEX]",
            arguments: {
                FIELD: {
                    type: Scratch.ArgumentType.STRING,
                    menu: "GAME_BOOLEAN",
                },
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        fn(args: any) {
            let field = String(args.FIELD);
            let index = Number(args.INDEX ?? 0);

            if (field === "match_is_overtime") {
                return this.lastGamePacket?.match_info?.is_overtime ?? false;
            }
            if (field === "match_is_unlimited_time") {
                return (
                    this.lastGamePacket?.match_info?.is_unlimited_time ?? false
                );
            }
            if (field === "boost_pad_active") {
                return (
                    this.lastGamePacket?.boost_pads?.[index]?.is_active ?? false
                );
            }

            let player = this.lastGamePacket?.players?.[index];
            if (!player) return false;

            if (field === "player_has_jumped") return player.has_jumped;
            if (field === "player_has_double_jumped")
                return player.has_double_jumped;
            if (field === "player_has_dodged") return player.has_dodged;
            if (field === "player_is_supersonic") return player.is_supersonic;
            if (field === "player_is_bot") return player.is_bot;

            let input = player.last_input;
            if (field === "player_last_input_jump") return input.jump;
            if (field === "player_last_input_boost") return input.boost;
            if (field === "player_last_input_handbrake") return input.handbrake;
            if (field === "player_last_input_use_item") return input.use_item;

            return false;
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerNumber",
            blockType: Scratch.BlockType.REPORTER,
            text: "player [INDEX] [FIELD]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
                FIELD: {
                    type: Scratch.ArgumentType.STRING,
                    menu: "PLAYER_NUMBER",
                },
            },
        },
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            if (!player) return 0;
            if (args.FIELD === "score") return player.score_info.score;
            if (args.FIELD === "goals") return player.score_info.goals;
            if (args.FIELD === "own_goals") return player.score_info.own_goals;
            if (args.FIELD === "assists") return player.score_info.assists;
            if (args.FIELD === "saves") return player.score_info.saves;
            if (args.FIELD === "shots") return player.score_info.shots;
            if (args.FIELD === "demolitions")
                return player.score_info.demolitions;
            if (args.FIELD === "last_input_throttle")
                return player.last_input.throttle;
            if (args.FIELD === "last_input_steer")
                return player.last_input.steer;
            if (args.FIELD === "last_input_pitch")
                return player.last_input.pitch;
            if (args.FIELD === "last_input_yaw") return player.last_input.yaw;
            if (args.FIELD === "last_input_roll") return player.last_input.roll;
            if (args.FIELD === "team") return player.team;
            if (args.FIELD === "boost") return player.boost;
            if (args.FIELD === "player_id") return player.player_id;
            if (args.FIELD === "dodge_timeout") return player.dodge_timeout;
            if (args.FIELD === "demolished_timeout")
                return player.demolished_timeout;
            if (args.FIELD === "dodge_elapsed") return player.dodge_elapsed;
            if (args.FIELD === "latest_touch_game_seconds")
                return player.latest_touch?.game_seconds ?? 0;
            if (args.FIELD === "latest_touch_ball_index")
                return player.latest_touch?.ball_index ?? -1;
            return 0;
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerString",
            blockType: Scratch.BlockType.REPORTER,
            text: "player [INDEX] [FIELD] text",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
                FIELD: {
                    type: Scratch.ArgumentType.STRING,
                    menu: "PLAYER_STRING",
                },
            },
        },
        fn(args: any) {
            let player = this.lastGamePacket?.players?.[args?.INDEX ?? 0];
            if (!player) return "null";
            if (args.FIELD === "name") return player.name;
            if (args.FIELD === "air_state") return player.air_state;
            return "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerIndexTeammate",
            blockType: Scratch.BlockType.REPORTER,
            text: "player index of teammate [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        fn(args: any) {
            if (!this.lastGamePacket) return "null";
            let indices = this.lastGamePacket.players
                .map((player, index) =>
                    player.team === this.ourTeam?.team ? index : -1,
                )
                .filter((index) => index !== -1);
            return indices[args?.INDEX ?? 0] ?? "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerIndexOpponent",
            blockType: Scratch.BlockType.REPORTER,
            text: "player index of opponent [INDEX]",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        fn(args: any) {
            if (!this.lastGamePacket) return "null";
            let indices = this.lastGamePacket.players
                .map((player, index) =>
                    player.team !== this.ourTeam?.team ? index : -1,
                )
                .filter((index) => index !== -1);
            return indices[args?.INDEX ?? 0] ?? "null";
        },
    },
    {
        block: {
            opcode: "gamePacketPlayerIndexOurs",
            blockType: Scratch.BlockType.REPORTER,
            text: "our player index",
        },
        fn(args: any) {
            if (!this.ourTeam) return "null";
            return this.ourTeam.controllables[0].index;
        },
    },
    "GamePacket - Match",
    {
        block: {
            opcode: "matchInfoNumber",
            blockType: Scratch.BlockType.REPORTER,
            text: "match [FIELD]",
            arguments: {
                FIELD: {
                    type: Scratch.ArgumentType.STRING,
                    menu: "MATCH_NUMBER",
                },
            },
        },
        fn(args) {
            let match = this.lastGamePacket?.match_info;
            if (!match) return 0;
            if (args.FIELD === "seconds_elapsed") return match.seconds_elapsed;
            if (args.FIELD === "game_time_remaining")
                return match.game_time_remaining;
            if (args.FIELD === "world_gravity_z") return match.world_gravity_z;
            if (args.FIELD === "game_speed") return match.game_speed;
            if (args.FIELD === "last_spectated") return match.last_spectated;
            if (args.FIELD === "frame_num") return match.frame_num;
            return 0;
        },
    },
    {
        block: {
            opcode: "matchInfoString",
            blockType: Scratch.BlockType.REPORTER,
            text: "match [FIELD] text",
            arguments: {
                FIELD: {
                    type: Scratch.ArgumentType.STRING,
                    menu: "MATCH_STRING",
                },
            },
        },
        fn(args) {
            let match = this.lastGamePacket?.match_info;
            if (!match) return "null";
            if (args.FIELD === "match_phase") return match.match_phase;
            return "null";
        },
    },
    "GamePacket - Teams/Boost",
    {
        block: {
            opcode: "teamScore",
            blockType: Scratch.BlockType.REPORTER,
            text: "team [INDEX] score",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        fn(args) {
            if (!this.lastGamePacket) return 0;
            return this.lastGamePacket.teams[args?.INDEX ?? 0]?.score ?? 0;
        },
    },
    {
        block: {
            opcode: "boostPadTimer",
            blockType: Scratch.BlockType.REPORTER,
            text: "boost pad [INDEX] timer",
            arguments: {
                INDEX: {
                    type: "number",
                    defaultValue: 0,
                },
            },
        },
        fn(args) {
            if (!this.lastGamePacket) return 0;
            return this.lastGamePacket.boost_pads[args?.INDEX ?? 0]?.timer ?? 0;
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
export const EXT_ID = "rlbotv5pluginv0";

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
                BALL_SHAPE_DIM: ["length", "width", "height", "diameter"],
                HITBOX_DIM: ["length", "width", "height"],
                GAME_BOOLEAN: [
                    "player_has_jumped",
                    "player_has_double_jumped",
                    "player_has_dodged",
                    "player_is_supersonic",
                    "player_is_bot",
                    "player_last_input_jump",
                    "player_last_input_boost",
                    "player_last_input_handbrake",
                    "player_last_input_use_item",
                    "match_is_overtime",
                    "match_is_unlimited_time",
                    "boost_pad_active",
                ],
                PLAYER_NUMBER: [
                    "score",
                    "goals",
                    "own_goals",
                    "assists",
                    "saves",
                    "shots",
                    "demolitions",
                    "last_input_throttle",
                    "last_input_steer",
                    "last_input_pitch",
                    "last_input_yaw",
                    "last_input_roll",
                    "team",
                    "boost",
                    "player_id",
                    "dodge_timeout",
                    "demolished_timeout",
                    "dodge_elapsed",
                    "latest_touch_game_seconds",
                    "latest_touch_ball_index",
                ],
                PLAYER_STRING: ["name", "air_state"],
                MATCH_NUMBER: [
                    "seconds_elapsed",
                    "game_time_remaining",
                    "world_gravity_z",
                    "game_speed",
                    "last_spectated",
                    "frame_num",
                ],
                MATCH_STRING: ["match_phase"],
            },
        };
    }
}

for (let cfg of blockConfigs) {
    if (typeof cfg === "string") continue;
    if (!("opcode" in cfg.block)) continue;
    (RLBotExt.prototype as any)[cfg.block.opcode] = function (...args: any[]) {
        try {
            return cfg.fn.call(this, args[0]);
        } catch (error) {
            // if we don't catch errors, execution freezes
            return `ERR: ${error}`;
        }
    };
}

export default RLBotExt;
