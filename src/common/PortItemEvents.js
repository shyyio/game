import {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";

// Render deltas for the resting item drawn in a render-flagged out-port; the render tile is derived
// client-side from the port id, so (x, y) here is only the routing position.

/**
 * An item now rests in a render-flagged out-port.
 */
export class PortItemSetEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
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
export class PortItemClearEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        x: "int32",
        y: "int32",
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
