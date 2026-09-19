import {AbstractChunkRoutedEvent} from "@/common/AbstractChunkRoutedEvent.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

// Render deltas for the resting item drawn in a render-flagged output port; the render tile is derived
// client-side from the port ref, so (x, y) only routes the event to its chunk topic and stays off the
// wire. `chunk` is therefore meaningless on a decoded port-item event.

/**
 * An item now rests in a render-flagged output port.
 */
export class PortItemSetEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        portRef: "int64",
        itemTypeId: "int32",
        birthTick: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} portRef
     * @param {number} itemTypeId
     * @param {number} birthTick
     */
    constructor(x, y, portRef, itemTypeId, birthTick) {
        super(x, y);
        this.portRef = portRef;
        this.itemTypeId = itemTypeId;
        this.birthTick = birthTick;
    }
}

/**
 * A render-flagged output port's resting item was removed.
 */
export class PortItemClearEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        portRef: "int64",
        consumed: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} portRef
     * @param {number} [consumed] - 1 when a consumer ate the item, so the client glides it out
     */
    constructor(x, y, portRef, consumed=0) {
        super(x, y);
        this.portRef = portRef;
        this.consumed = consumed;
    }
}

/**
 * One chunk's port-item deltas for a render pass: each set is `setPortRefs[i]` now holding
 * `setItemTypeIds[i]`, each clear is a `clearPortRefs` entry.
 */
export class PortItemBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        clock: "int32",
        setPortRefs: "int64[]",
        setItemTypeIds: "int32[]",
        setAges: "int32[]",
        clearPortRefs: "int64[]",
        clearConsumed: "int32[]",
    };

    /**
     * @param {number} x - a port position in the batched chunk, routing the batch to that topic
     * @param {number} y
     * @param {number} clock - the tick the rows were read on, which their ages count back from
     */
    constructor(x, y, clock) {
        super(x, y);
        this.clock = clock;
        this.setPortRefs = [];
        this.setItemTypeIds = [];
        this.setAges = [];
        this.clearPortRefs = [];
        this.clearConsumed = [];
    }

    /**
     * @param {number} portRef
     * @param {number} itemTypeId
     * @param {number} birthTick
     * @returns {void}
     */
    addSet(portRef, itemTypeId, birthTick) {
        this.setPortRefs.push(portRef);
        this.setItemTypeIds.push(itemTypeId);
        this.setAges.push(this.clock - birthTick);
    }

    /**
     * @param {number} portRef
     * @param {number} [consumed] - 1 when a consumer ate the item
     * @returns {void}
     */
    addClear(portRef, consumed=0) {
        this.clearPortRefs.push(portRef);
        this.clearConsumed.push(consumed);
    }

    /**
     * Clears come first, so a port cleared and refilled in the same pass ends up set.
     * @returns {(PortItemSetEvent|PortItemClearEvent)[]}
     */
    explode() {
        const events = [];
        for (let i = 0; i < this.clearPortRefs.length; i += 1) {
            events.push(new PortItemClearEvent(this.x, this.y, this.clearPortRefs[i], this.clearConsumed[i]));
        }
        for (let i = 0; i < this.setPortRefs.length; i += 1) {
            events.push(new PortItemSetEvent(
                this.x, this.y, this.setPortRefs[i], this.setItemTypeIds[i], this.clock - this.setAges[i],
            ));
        }
        return events;
    }
}
