import {AbstractChunkRoutedEvent} from "@/common/AbstractChunkRoutedEvent.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

// Generic object lifecycle events, tagged with the object type's `objectTypeId`. `portRefs` are the rendered
// output port refs in `outputPorts.filter(render)` order (the client zips them back to names).

/**
 * An object the player just placed.
 */
export class ObjectInsertEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        objectTypeId: "int32",
        objectRef: "int64",
        x: "sint32",
        y: "sint32",
        direction: "int32",
        portRefs: "int64[]",
    };

    /**
     * @param {number} objectTypeId
     * @param {number} objectRef
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number[]} portRefs
     */
    constructor(objectTypeId, objectRef, x, y, direction, portRefs) {
        super(x, y);
        this.objectTypeId = objectTypeId;
        this.objectRef = objectRef;
        this.direction = direction;
        this.portRefs = portRefs;
    }
}

/**
 * An object synced into a loaded chunk; same payload as the insert but a distinct type so the client
 * skips placement feedback.
 */
export class ObjectSyncEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        objectTypeId: "int32",
        objectRef: "int64",
        x: "sint32",
        y: "sint32",
        direction: "int32",
        portRefs: "int64[]",
    };

    /**
     * @param {number} objectTypeId
     * @param {number} objectRef
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number[]} portRefs
     */
    constructor(objectTypeId, objectRef, x, y, direction, portRefs) {
        super(x, y);
        this.objectTypeId = objectTypeId;
        this.objectRef = objectRef;
        this.direction = direction;
        this.portRefs = portRefs;
    }
}

/**
 * An object the player just removed.
 */
export class ObjectDeleteEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        objectTypeId: "int32",
        objectRef: "int64",
        x: "sint32",
        y: "sint32",
    };

    /**
     * @param {number} objectTypeId
     * @param {number} objectRef
     * @param {number} x
     * @param {number} y
     */
    constructor(objectTypeId, objectRef, x, y) {
        super(x, y);
        this.objectTypeId = objectTypeId;
        this.objectRef = objectRef;
    }
}

/**
 * One chunk's objects for a sync, as packed columns: entity `i` is `objectTypeIds[i]` with ref `objectRefs[i]` at
 * (`tileX[i]`, `tileY[i]`) — chunk-relative, so a tile offset stays one byte however far the chunk
 * sits from the origin — facing `directions[i]`, owning the next `portCounts[i]` entries of the
 * flattened `portRefs`.
 */
export class ObjectSyncBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        originX: "sint32",
        originY: "sint32",
        objectTypeIds: "int32[]",
        objectRefs: "int64[]",
        tileX: "sint32[]",
        tileY: "sint32[]",
        directions: "int32[]",
        portCounts: "int32[]",
        portRefs: "int64[]",
    };

    /**
     * @param {number} originX - the batched chunk's origin tile, which also routes the batch
     * @param {number} originY
     */
    constructor(originX, originY) {
        super(originX, originY);
        this.originX = originX;
        this.originY = originY;
        this.objectTypeIds = [];
        this.objectRefs = [];
        this.tileX = [];
        this.tileY = [];
        this.directions = [];
        this.portCounts = [];
        this.portRefs = [];
    }

    /**
     * @param {number} objectTypeId
     * @param {number} objectRef
     * @param {number} x
     * @param {number} y
     * @param {number} direction
     * @param {number[]} portRefs
     * @returns {void}
     */
    add(objectTypeId, objectRef, x, y, direction, portRefs) {
        this.objectTypeIds.push(objectTypeId);
        this.objectRefs.push(objectRef);
        this.tileX.push(x - this.originX);
        this.tileY.push(y - this.originY);
        this.directions.push(direction);
        this.portCounts.push(portRefs.length);
        for (const portRef of portRefs) {
            this.portRefs.push(portRef);
        }
    }

    /**
     * @returns {ObjectSyncEvent[]}
     */
    explode() {
        const events = [];
        let portAt = 0;
        for (let i = 0; i < this.objectRefs.length; i += 1) {
            const portRefs = this.portRefs.slice(portAt, portAt + this.portCounts[i]);
            portAt += this.portCounts[i];
            events.push(new ObjectSyncEvent(
                this.objectTypeIds[i],
                this.objectRefs[i],
                this.originX + this.tileX[i],
                this.originY + this.tileY[i],
                this.directions[i],
                portRefs,
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
        objectRef: "int64",
        values: "sint32[]",
    };

    /**
     * @param {number} objectRef
     * @param {number} x
     * @param {number} y
     * @param {number[]} values
     */
    constructor(objectRef, x, y, values) {
        super(x, y);
        this.objectRef = objectRef;
        this.values = values;
    }
}

/**
 * One chunk's synced-field deltas for one behavior, as packed columns: object `i` is `objectRefs[i]`,
 * owning the next `fieldCount` entries of the flattened `values`.
 */
export class ObjectFieldsBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        fieldCount: "int32",
        objectRefs: "int64[]",
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
        this.objectRefs = [];
        this.values = [];
    }

    /**
     * @param {number} objectRef
     * @param {number[]} values
     * @returns {void}
     */
    add(objectRef, values) {
        this.objectRefs.push(objectRef);
        for (const value of values) {
            this.values.push(value);
        }
    }

    /**
     * @returns {ObjectFieldsEvent[]}
     */
    explode() {
        const events = [];
        for (let i = 0; i < this.objectRefs.length; i += 1) {
            const at = i * this.fieldCount;
            events.push(new ObjectFieldsEvent(this.objectRefs[i], this.x, this.y, this.values.slice(at, at + this.fieldCount)));
        }
        return events;
    }
}
