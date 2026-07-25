import {DEV} from "@/common/env.js";
import {AbstractSession} from "@/common/AbstractSession.js";

export class LocalSession extends AbstractSession {

    setId(sessionId) {
        this.id = sessionId;
    }

    sendMessage(message) {
        if (DEV) {
            // Test wire encoding/decoding
            this.api.sendMessage(this.api.wire.decode(this.api.wire.encode(message)), this);
        } else {
            this.api.sendMessage(message, this);
        }
    }

    publishEvent(event) {
        if (this.client == null) {
            return;
        }
        if (!DEV) {
            this.client.publishEvent(event);
            return;
        }
        // Round-trip through the wire codec, so a codec break surfaces in single-player too.
        const encoded = this.api.wire.encode(event);
        this.client.publishEvent(this.api.wire.decode(encoded), encoded.length);
    }

    get playerId() {
        return 0;
    }
}
