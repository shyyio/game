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
        if (DEV) {
            const encoded = this.api.wire.encode(event);
            this.client.publishEvent(this.api.wire.decode(encoded), encoded.length);
        } else {
            this.client.publishEvent(event);
        }
    }
}
