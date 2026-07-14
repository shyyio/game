import {AbstractSession} from "@/common/AbstractSession.js";

/**
 * Backend session handle, instantiated when a new WS client connects.
 */
export class RemoteSessionServerHandle extends AbstractSession {

    constructor(api, ctx) {
        super(api);

        this.ctx = ctx;

        // onmessage -> sendMessage()
    }

    publishEvent(event) {
        // wsServer.batchEvent(ctx, event)
    }

    setId(sessionId) {
        this.id = sessionId;

        // TODO: Send this to client? Does the client need to know its session Id?
    }

    sendMessage(message) {
        this.api.sendMessage(message, this);
    }
}
