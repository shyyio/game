import {AbstractSession} from "@/common/AbstractSession.js";

/**
 * Browser's version of the session. On the client side, it is instantiated,
 * then connect is called.
 */
export class RemoteSessionClientHandle extends AbstractSession {

    connect(arg) {
        // Connect to the server WS
        // register message listener msg => this.publishEvent(...)
        // session id -> this.id = id
    }

    setId(sessionId) {
        throw Error("Not implemented");
    }

    sendMessage(message) {
        // send WS message
    }
}
