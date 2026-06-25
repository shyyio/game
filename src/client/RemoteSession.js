import {AbstractSession} from "@/common/AbstractSession.js";

/**
 * Browser-side session handle, instantiated then connected.
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
