import {DEV} from "@/common/env.js";
import {AbstractSession} from "@/common/AbstractSession.js";

export class LocalSession extends AbstractSession {

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
        if (DEV) {
            // Round-trip through the protobuf wire format (exercising it), and report the
            // encoded byte count to the client's received-bytes counter.
            const encoded = this.api.wire.encode(event);
            this.client.publishEvent(this.api.wire.decode(encoded), encoded.length);
            return;
        }
        this.client.publishEvent(event);
    }
}
