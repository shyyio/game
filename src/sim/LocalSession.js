import {DEV} from "@/common/env.js";
import {AbstractSession} from "@/common/AbstractSession.js";

export class LocalSession extends AbstractSession {

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
            // Round-trip through the wire codec, so a codec break surfaces in single-player too.
            const encoded = this.api.wire.encode(event);
            this.client.events.dispatch(this.api.wire.decode(encoded), encoded.length);
        } else {
            this.client.events.dispatch(event);
        }
    }

    get playerRef() {
        return 1;
    }

    get isLocal() {
        return true;
    }
}
