import type {
    ControllableTeamInfo,
    ControllerState,
    CorePacket,
    GamePacket,
    InterfacePacket,
} from "./rlbot";

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

    getInfo(): Scratch.Info {
        return {
            id: "rlbotv5",
            name: "RLBot v5",
            blocks: [
                {
                    opcode: "onTick",
                    blockType: Scratch.BlockType.EVENT,
                    text: "every game tick",
                    isEdgeActivated: false,
                    shouldRestartExistingThreads: false,
                },
                {
                    opcode: "initComplete",
                    blockType: Scratch.BlockType.COMMAND,
                    text: "send InitComplete",
                },
                {
                    opcode: "sendController",
                    blockType: Scratch.BlockType.COMMAND,
                    text: "send Controller Inputs",
                },
                {
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
            ],
        };
    }

    connect(args: any) {
        // TODO: Override args.PORT when running in headless deno
        console.log(`Connecting to RLBot scratch bridge on port ${args.PORT}`);
        if (this.ws) {
            this.ws.close();
        }
        this.ws = new WebSocket(`ws://127.0.0.1:${args.PORT}`);
        this.ws.onopen = () => {
            console.log("Connected to RLBot scratch bridge");
        };
        this.ws.onmessage = (event: any) => {
            let json_str = event.data;
            // TODO: Store all of this in this class and also call new event "tick"
            let packet: CorePacket = JSON.parse(json_str);

            let gamepacket = (packet.message as { GamePacket: GamePacket })
                .GamePacket;

            if (packet) {
                this.lastGamePacket = gamepacket;
                // @ts-expect-error; the types are for unsandboxed extension, we're not
                Scratch.vm.runtime.startHats("rlbotv5_onTick");
            }

            let controllerteaminfo = (
                packet.message as { ControllableTeamInfo: ControllableTeamInfo }
            ).ControllableTeamInfo;
            if (controllerteaminfo) {
                this.ourTeam = controllerteaminfo;
            }
        };
    }

    initComplete() {
        let packet: InterfacePacket = {
            message: { InitComplete: {} },
        };
        if (this.ws?.readyState == WebSocket.CONNECTING) {
            this.ws.onopen = (a) => {
                // this event handler overrides the on above, that should not be
                // the case. TODO: fix this in ext_websocket
                this.ws?.send(JSON.stringify(packet));
            };
        } else {
            this.ws?.send(JSON.stringify(packet));
        }
    }

    sendController() {
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
    }
}

export default RLBotExt;
