import {AbstractChunkRoutedEvent} from "@/common/AbstractChunkRoutedEvent.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

// Render deltas for the resting item drawn in a render-flagged out-port; the render tile is derived
// client-side from the port id, so (x, y) only routes the event to its chunk topic and stays off the
// wire. `chunk` is therefore meaningless on a decoded port-item event.

/**
 * An item now rests in a render-flagged out-port.
 */
export class PortItemSetEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        portId: "int64",
        itemType: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} portId
     * @param {number} itemType
     */
    constructor(x, y, portId, itemType) {
        super(x, y);
        this.portId = portId;
        this.itemType = itemType;
    }
}

/**
 * A render-flagged out-port's resting item was removed.
 */
export class PortItemClearEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        portId: "int64",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} portId
     */
    constructor(x, y, portId) {
        super(x, y);
        this.portId = portId;
    }
}

/**
 * One chunk's port-item deltas for a render pass: each set is `setPortIds[i]` now holding
 * `setItemTypes[i]`, each clear is a `clearPortIds` entry.
 */
export class PortItemBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        setPortIds: "int64[]",
        setItemTypes: "int32[]",
        clearPortIds: "int64[]",
    };

    /**
     * @param {number} x - a port position in the batched chunk, routing the batch to that topic
     * @param {number} y
     */
    constructor(x, y) {
        super(x, y);
        this.setPortIds = [];
        this.setItemTypes = [];
        this.clearPortIds = [];
    }

    /**
     * @param {number} portId
     * @param {number} itemType
     * @returns {void}
     */
    addSet(portId, itemType) {
        this.setPortIds.push(portId);
        this.setItemTypes.push(itemType);
    }

    /**
     * @param {number} portId
     * @returns {void}
     */
    addClear(portId) {
        this.clearPortIds.push(portId);
    }

    /**
     * Clears come first, so a port cleared and refilled in the same pass ends up set.
     * @returns {(PortItemSetEvent|PortItemClearEvent)[]}
     */
    explode() {
        const events = [];
        for (const portId of this.clearPortIds) {
            events.push(new PortItemClearEvent(this.x, this.y, portId));
        }
        for (let i = 0; i < this.setPortIds.length; i += 1) {
            events.push(new PortItemSetEvent(this.x, this.y, this.setPortIds[i], this.setItemTypes[i]));
        }
        return events;
    }
}
