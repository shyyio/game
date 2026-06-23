import {chunkKey} from "@/common/util.js";
import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * An event tied to a tile position in the world. Adds (x, y) and a `chunk` derived
 * from them on demand, so the chunk is neither stored nor sent over the wire and is
 * available on wire-decoded instances too.
 */
export class AbstractTilePositionedEvent extends AbstractEvent {

    /**
     * @param {number} x
     * @param {number} y
     */
    constructor(x, y) {
        super();
        this.x = x;
        this.y = y;
    }

    /**
     * @returns {string}
     */
    get chunk() {
        return chunkKey(this.x, this.y);
    }
}
