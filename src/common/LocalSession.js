import {DEV} from "@/common/env.js";
import {Session} from "@/common/Session.js";

export class LocalSession extends Session {

    constructor(api) {
        super(api);
    }

    setId(sessionId) {
        this.id = sessionId;
    }

    sendMessage(message) {
        // In dev, round-trip through the protobuf wire format so the encoding
        // used by RemoteSession is always exercised; skipped in production to
        // avoid the overhead for single-player.
        const outgoing = DEV ? this.api.wire.decode(this.api.wire.encode(message)) : message;
        this.api.sendMessage(outgoing, this);
    }

    publishEvent(event) {
        if (this.client == null) {
            return;
        }
        const outgoing = DEV ? this.api.wire.decode(this.api.wire.encode(event)) : event;
        this.client.publishEvent(outgoing);
    }
}
