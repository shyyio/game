import {AbstractSession} from "@/common/AbstractSession.js";

/**
 * Backend version of the session. On the server side, it is instantiated
 * when a new WS client connects.
 *
 * On the server: session = new RemoteSessionServerHandle(api, ctx);
 *                game.connect(session);
 */
export class RemoteSessionServerHandle extends AbstractSession {

    constructor(api, ctx) {
        super(api);

        this.ctx = ctx;

        // onmessage -> sendMessage()
    }

    publishEvent(type, event) {
        // wsServer.batchEvent(ctx, type, event)
    }

    setId(sessionId) {
        this.id = sessionId;

        // TODO: Send this to client? Does the client need to know its session Id?
    }

    sendMessage(message) {
        this.api.sendMessage(message);
    }
}
