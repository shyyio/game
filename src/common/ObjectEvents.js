import {AbstractChunkRoutedEvent} from "@/common/AbstractChunkRoutedEvent.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

// Generic object lifecycle events, tagged with the object type's `typeId`. `portIds` are the rendered
// out-port ids in `outputPorts.filter(render)` order (the client zips them back to names).

/**
 * An object the player just placed.
 */
export class ObjectInsertEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        typeId: "int32",
        id: "int64",
        x: "sint32",
        y: "sint32",
        direction: "int32",
        portIds: "int64[]",
    };

    /**
     * @param {number} typeId
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number[]} portIds
     */
    constructor(typeId, id, x, y, direction, portIds) {
        super(x, y);
        this.typeId = typeId;
        this.id = id;
        this.direction = direction;
        this.portIds = portIds;
    }
}

/**
 * An object synced into a loaded chunk; same payload as the insert but a distinct type so the client
 * skips placement feedback.
 */
export class ObjectSyncEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        typeId: "int32",
        id: "int64",
        x: "sint32",
        y: "sint32",
        direction: "int32",
        portIds: "int64[]",
    };

    /**
     * @param {number} typeId
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number[]} portIds
     */
    constructor(typeId, id, x, y, direction, portIds) {
        super(x, y);
        this.typeId = typeId;
        this.id = id;
        this.direction = direction;
        this.portIds = portIds;
    }
}

/**
 * An object the player just removed.
 */
export class ObjectDeleteEvent extends AbstractChunkRoutedEvent {

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
 * flattened `portIds`.
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
    }

    /**
     * @param {number} typeId
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {number} direction
     * @param {number[]} portIds
     * @returns {void}
     */
    add(typeId, id, x, y, direction, portIds) {
        this.typeIds.push(typeId);
        this.ids.push(id);
        this.tileX.push(x - this.originX);
        this.tileY.push(y - this.originY);
        this.directions.push(direction);
        this.portCounts.push(portIds.length);
        for (const portId of portIds) {
            this.portIds.push(portId);
        }
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
            events.push(new ObjectSyncEvent(
                this.typeIds[i],
                this.ids[i],
                this.originX + this.tileX[i],
                this.originY + this.tileY[i],
                this.directions[i],
                portIds,
            ));
        }
        return events;
    }
}

/**
 * One object's synced fields, in its behavior's declared order; also the corrective payload sent
 * to a single session.
 */
export class ObjectFieldsEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        id: "int64",
        values: "sint32[]",
    };

    /**
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {number[]} values
     */
    constructor(id, x, y, values) {
        super(x, y);
        this.id = id;
        this.values = values;
    }
}

/**
 * One chunk's synced-field deltas for one behavior, as packed columns: object `i` is `ids[i]`,
 * owning the next `fieldCount` entries of the flattened `values`.
 */
export class ObjectFieldsBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        fieldCount: "int32",
        ids: "int64[]",
        values: "sint32[]",
    };

    /**
     * @param {number} x - a member object's tile in the batched chunk, routes the batch to that topic
     * @param {number} y
     * @param {number} fieldCount
     */
    constructor(x, y, fieldCount) {
        super(x, y);
        this.fieldCount = fieldCount;
        this.ids = [];
        this.values = [];
    }

    /**
     * @param {number} id
     * @param {number[]} values
     * @returns {void}
     */
    add(id, values) {
        this.ids.push(id);
        for (const value of values) {
            this.values.push(value);
        }
    }

    /**
     * @returns {ObjectFieldsEvent[]}
     */
    explode() {
        const events = [];
        for (let i = 0; i < this.ids.length; i += 1) {
            const at = i * this.fieldCount;
            events.push(new ObjectFieldsEvent(this.ids[i], this.x, this.y, this.values.slice(at, at + this.fieldCount)));
        }
        return events;
    }
}
