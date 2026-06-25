import {chunkKey} from "@/common/util.js";
import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * An event tied to a tile position, adding (x, y) and a `chunk` derived from them (never wired).
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
