import {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

// Column sentinel for an object that has produced nothing, so `lastOutputs` stays a plain int
// column; the per-object events keep using null. Zero, not -1: an `int32` column sign-extends a
// negative to a 10-byte varint.
const EMPTY_OUTPUT = 0;

// Generic object lifecycle events, tagged with the object type's `typeId`. `portIds` are the rendered
// out-port ids in `outputPorts.filter(render)` order (the client zips them back to names). `lastOutput`
// is the object's last produced item (0 = none), so a client can show production at a glance.

/**
 * An object the player just placed.
 */
export class ObjectInsertEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        typeId: "int32",
        id: "int64",
        x: "sint32",
        y: "sint32",
        direction: "int32",
        portIds: "int64[]",
        lastOutput: "int32?",
    };

    /**
     * @param {number} typeId
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number[]} portIds
     * @param {number|null} lastOutput
     */
    constructor(typeId, id, x, y, direction, portIds, lastOutput) {
        super(x, y);
        this.typeId = typeId;
        this.id = id;
        this.direction = direction;
        this.portIds = portIds;
        this.lastOutput = lastOutput;
    }
}

/**
 * An object synced into a loaded chunk; same payload as the insert but a distinct type so the client
 * skips placement feedback.
 */
export class ObjectSyncEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        typeId: "int32",
        id: "int64",
        x: "sint32",
        y: "sint32",
        direction: "int32",
        portIds: "int64[]",
        lastOutput: "int32?",
    };

    /**
     * @param {number} typeId
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number[]} portIds
     * @param {number|null} lastOutput
     */
    constructor(typeId, id, x, y, direction, portIds, lastOutput) {
        super(x, y);
        this.typeId = typeId;
        this.id = id;
        this.direction = direction;
        this.portIds = portIds;
        this.lastOutput = lastOutput;
    }
}

/**
 * An object the player just removed.
 */
export class ObjectDeleteEvent extends AbstractTilePositionedEvent {

    static wireFields = {
        typeId: "int32",
        id: "int64",
        x: "sint32",
        y: "sint32",
    };

    /**
     * @param {number} typeId
     * @param {number} id
     * @param {number} x
     * @param {number} y
     */
    constructor(typeId, id, x, y) {
        super(x, y);
        this.typeId = typeId;
        this.id = id;
    }
}

/**
 * One chunk's objects for a sync, as packed columns: entity `i` is `typeIds[i]` with id `ids[i]` at
 * (`tileX[i]`, `tileY[i]`) — chunk-relative, so a tile offset stays one byte however far the chunk
 * sits from the origin — facing `directions[i]`, owning the next `portCounts[i]` entries of the
 * flattened `portIds`. `lastOutputs` uses EMPTY_OUTPUT for an object that has produced nothing.
 */
export class ObjectSyncBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        originX: "sint32",
        originY: "sint32",
        typeIds: "int32[]",
        ids: "int64[]",
        tileX: "sint32[]",
        tileY: "sint32[]",
        directions: "int32[]",
        portCounts: "int32[]",
        portIds: "int64[]",
        lastOutputs: "int32[]",
    };

    /**
     * @param {number} originX - the batched chunk's origin tile, which also routes the batch
     * @param {number} originY
     */
    constructor(originX, originY) {
        super(originX, originY);
        this.originX = originX;
        this.originY = originY;
        this.typeIds = [];
        this.ids = [];
        this.tileX = [];
        this.tileY = [];
        this.directions = [];
        this.portCounts = [];
        this.portIds = [];
        this.lastOutputs = [];
    }

    /**
     * @param {number} typeId
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {number} direction
     * @param {number[]} portIds
     * @param {number|null} lastOutput
     * @returns {void}
     */
    add(typeId, id, x, y, direction, portIds, lastOutput) {
        this.typeIds.push(typeId);
        this.ids.push(id);
        this.tileX.push(x - this.originX);
        this.tileY.push(y - this.originY);
        this.directions.push(direction);
        this.portCounts.push(portIds.length);
        this.portIds.push(...portIds);
        this.lastOutputs.push(lastOutput === null ? EMPTY_OUTPUT : lastOutput);
    }

    /**
     * @returns {ObjectSyncEvent[]}
     */
    explode() {
        const events = [];
        let portAt = 0;
        for (let i = 0; i < this.ids.length; i += 1) {
            const portIds = this.portIds.slice(portAt, portAt + this.portCounts[i]);
            portAt += this.portCounts[i];
            const lastOutput = this.lastOutputs[i] === EMPTY_OUTPUT ? null : this.lastOutputs[i];
            events.push(new ObjectSyncEvent(
                this.typeIds[i],
                this.ids[i],
                this.originX + this.tileX[i],
                this.originY + this.tileY[i],
                this.directions[i],
                portIds,
                lastOutput,
            ));
        }
        return events;
    }
}
