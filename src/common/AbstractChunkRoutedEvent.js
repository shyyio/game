import {chunkId} from "@/common/util.js";
import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * An event routed to the chunk topic derived from its (x, y) tile position (`chunk` never wired).
 */
export class AbstractChunkRoutedEvent extends AbstractEvent {

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
