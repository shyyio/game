import {getChunk} from "@/util.js";

// TODO: When multiplayer is implemented, each LiveEvent subclass will need
//       protobuf encode/decode methods for transmission over the wire.
export class LiveEvent {

    /**
     * @param {number} type
     * @param {number} x
     * @param {number} y
     */
    constructor(type, x, y) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.chunk = getChunk(x, y);
    }
}
