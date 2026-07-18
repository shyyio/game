import {chunkId} from "@/common/util.js";
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
     * @returns {number}
     */
    get chunk() {
        return chunkId(this.x, this.y);
    }

    /**
     * @param {EventBus} bus
     * @returns {Set<number>|undefined}
     */
    subscribersIn(bus) {
        return bus.chunkSubscribers(this.chunk);
    }
}
