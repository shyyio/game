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
        
        // Early return was confusing here. The special case (DEV) should be the one
        // being tested for in the if()
        if (DEV) {
            // Round-trip through the wire codec, so a codec break surfaces in single-player too.
            const encoded = this.api.wire.encode(event);
            this.client.events.dispatch(this.api.wire.decode(encoded), encoded.length);
        } else {
            this.client.events.dispatch(event);
        }
    }

    get playerRef() {
        // Don't document what something ISNT. That's not helpful
        return 1;
    }

    get isLocal() {
        return true;
    }
}
