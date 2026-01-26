((window) => {
    const core = Deno.core;
    const ops = core.ops;

    const CONNECTING = 0;
    const OPEN = 1;
    const CLOSING = 2;
    const CLOSED = 3;

    class WebSocket extends EventTarget {
        #readyState = CONNECTING;
        #url = "";
        #protocol = "";
        #extensions = "";
        #binaryType = "blob";
        #rid = null;
        #eventLoop = null;

        // Event handlers
        onopen = null;
        onmessage = null;
        onerror = null;
        onclose = null;

        constructor(url, protocols = []) {
            super();

            if (!url) {
                throw new TypeError(
                    "Failed to construct 'WebSocket': 1 argument required, but only 0 present.",
                );
            }

            // Normalize protocols
            if (typeof protocols === "string") {
                protocols = [protocols];
            } else if (!Array.isArray(protocols)) {
                protocols = [];
            }

            // Validate URL - simple validation without full URL parsing
            if (typeof url !== "string") {
                throw new TypeError(
                    `Failed to construct 'WebSocket': The URL '${url}' is invalid.`,
                );
            }

            const urlLower = url.toLowerCase();
            if (
                !urlLower.startsWith("ws://") &&
                !urlLower.startsWith("wss://")
            ) {
                throw new TypeError(
                    `Failed to construct 'WebSocket': The URL's scheme must be either 'ws' or 'wss'.`,
                );
            }

            this.#url = url;

            // Validate protocols
            for (const protocol of protocols) {
                if (typeof protocol !== "string") {
                    throw new TypeError("Invalid protocol");
                }
                // Check for invalid characters
                if (!/^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/.test(protocol)) {
                    throw new TypeError(
                        `Failed to construct 'WebSocket': The subprotocol '${protocol}' is invalid.`,
                    );
                }
            }

            // Check for duplicate protocols
            const uniqueProtocols = new Set(protocols);
            if (uniqueProtocols.size !== protocols.length) {
                throw new TypeError(
                    "Failed to construct 'WebSocket': The subprotocol list contains duplicates.",
                );
            }

            // Start connection
            this.#connect(protocols);
        }

        async #connect(protocols) {
            try {
                this.#rid = await ops.op_ws_create(this.#url, protocols);

                // Get the selected protocol
                this.#protocol = await ops.op_ws_get_protocol(this.#rid);

                this.#readyState = OPEN;

                // Dispatch open event
                this.dispatchEvent(new Event("open"));
                if (this.onopen) {
                    this.onopen(new Event("open"));
                }

                // Start event loop
                this.#eventLoop = this.#runEventLoop();
            } catch (error) {
                this.#readyState = CLOSED;

                const errorEvent = new ErrorEvent("error", {
                    error,
                    message: error.message,
                });
                this.dispatchEvent(errorEvent);
                if (this.onerror) {
                    this.onerror(errorEvent);
                }

                const closeEvent = new CloseEvent("close", {
                    wasClean: false,
                    code: 1006,
                    reason: "",
                });
                this.dispatchEvent(closeEvent);
                if (this.onclose) {
                    this.onclose(closeEvent);
                }
            }
        }

        async #runEventLoop() {
            while (this.#readyState === OPEN || this.#readyState === CLOSING) {
                try {
                    const event = await ops.op_ws_next_event(this.#rid);

                    if (event.type === "message") {
                        let data;
                        if (typeof event.data === "string") {
                            data = event.data;
                        } else {
                            // Binary data
                            const bytes = new Uint8Array(event.data);
                            if (this.#binaryType === "blob") {
                                data = new Blob([bytes]);
                            } else {
                                data = bytes.buffer;
                            }
                        }

                        const messageEvent = new MessageEvent("message", {
                            data,
                        });
                        this.dispatchEvent(messageEvent);
                        if (this.onmessage) {
                            this.onmessage(messageEvent);
                        }
                    } else if (event.type === "close") {
                        this.#readyState = CLOSED;

                        const closeEvent = new CloseEvent("close", {
                            wasClean:
                                this.#readyState === CLOSING ||
                                event.code === 1000,
                            code: event.code,
                            reason: event.reason,
                        });
                        this.dispatchEvent(closeEvent);
                        if (this.onclose) {
                            this.onclose(closeEvent);
                        }
                        break;
                    } else if (event.type === "error") {
                        const errorEvent = new ErrorEvent("error", {
                            message: event.message,
                        });
                        this.dispatchEvent(errorEvent);
                        if (this.onerror) {
                            this.onerror(errorEvent);
                        }
                    }
                    // Ignore ping/pong events (handled automatically by tungstenite)
                } catch (error) {
                    this.#readyState = CLOSED;

                    const errorEvent = new ErrorEvent("error", {
                        error,
                        message: error.message,
                    });
                    this.dispatchEvent(errorEvent);
                    if (this.onerror) {
                        this.onerror(errorEvent);
                    }

                    const closeEvent = new CloseEvent("close", {
                        wasClean: false,
                        code: 1006,
                        reason: "",
                    });
                    this.dispatchEvent(closeEvent);
                    if (this.onclose) {
                        this.onclose(closeEvent);
                    }
                    break;
                }
            }
        }

        send(data) {
            if (this.#readyState === CONNECTING) {
                throw new Error(
                    "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
                );
            }

            if (this.#readyState !== OPEN) {
                return;
            }

            if (typeof data === "string") {
                ops.op_ws_send_text(this.#rid, data);
            } else if (data instanceof Blob) {
                // Convert Blob to ArrayBuffer
                data.arrayBuffer().then((buffer) => {
                    if (this.#readyState === OPEN) {
                        ops.op_ws_send_binary(
                            this.#rid,
                            new Uint8Array(buffer),
                        );
                    }
                });
            } else if (data instanceof ArrayBuffer) {
                ops.op_ws_send_binary(this.#rid, new Uint8Array(data));
            } else if (ArrayBuffer.isView(data)) {
                ops.op_ws_send_binary(
                    this.#rid,
                    new Uint8Array(
                        data.buffer,
                        data.byteOffset,
                        data.byteLength,
                    ),
                );
            } else {
                throw new TypeError(
                    "Failed to execute 'send' on 'WebSocket': The data provided is neither a string, Blob, ArrayBuffer, nor ArrayBufferView.",
                );
            }
        }

        close(code = 1000, reason = "") {
            if (this.#readyState === CLOSING || this.#readyState === CLOSED) {
                return;
            }

            // Validate code
            if (code !== 1000 && (code < 3000 || code > 4999)) {
                if (code < 1000 || code > 4999) {
                    throw new Error(
                        `Failed to execute 'close' on 'WebSocket': The code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
                    );
                }
                // Codes 1001-2999 are reserved but we'll allow some common ones
                const allowedCodes = [
                    1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011,
                ];
                if (!allowedCodes.includes(code)) {
                    throw new Error(
                        `Failed to execute 'close' on 'WebSocket': The code ${code} is reserved and cannot be used.`,
                    );
                }
            }

            // Validate reason
            if (reason && new TextEncoder().encode(reason).length > 123) {
                throw new Error(
                    "Failed to execute 'close' on 'WebSocket': The message must not be greater than 123 bytes.",
                );
            }

            this.#readyState = CLOSING;

            if (this.#rid !== null) {
                ops.op_ws_close(this.#rid, code, reason).catch(() => {
                    // Ignore errors during close
                });
            }
        }

        get url() {
            return this.#url;
        }

        get readyState() {
            return this.#readyState;
        }

        get bufferedAmount() {
            // Simplified - tungstenite handles buffering
            return 0;
        }

        get extensions() {
            return this.#extensions;
        }

        get protocol() {
            return this.#protocol;
        }

        get binaryType() {
            return this.#binaryType;
        }

        set binaryType(value) {
            if (value === "blob" || value === "arraybuffer") {
                this.#binaryType = value;
            }
        }

        // Constants
        static get CONNECTING() {
            return CONNECTING;
        }
        static get OPEN() {
            return OPEN;
        }
        static get CLOSING() {
            return CLOSING;
        }
        static get CLOSED() {
            return CLOSED;
        }

        get CONNECTING() {
            return CONNECTING;
        }
        get OPEN() {
            return OPEN;
        }
        get CLOSING() {
            return CLOSING;
        }
        get CLOSED() {
            return CLOSED;
        }
    }

    window.WebSocket = WebSocket;
})(globalThis);
