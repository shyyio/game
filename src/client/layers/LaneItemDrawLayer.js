import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {Direction} from "@/common/constants.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import {
    LaneGeometryEvent,
    LaneItemUpsertEvent,
    LaneItemSyncEvent,
    LaneItemDeleteEvent,
    LaneItemResetEvent,
} from "@/common/LaneEvents.js";

// Item sprite keys, namespaced away from the port and belt keys sharing the item layer.
const LANE_SPRITE_KEY = (laneRef, itemRef) => `lane:${laneRef}:${itemRef}`;
const LANE_PORT_SPRITE_KEY = portId => `lanePort:${portId}`;

/**
 * One lane as the client knows it: the cells the sim last told it about, and the item rows riding
 * them.
 */
class LaneRecord {

    /**
     * @param {number[]} cellObjectRefs - head first
     * @param {Direction[]} cellParentEdges - the edge each cell is fed over, in its own frame
     * @param {number} outPortRef
     */
    constructor(cellObjectRefs, cellParentEdges, outPortRef) {
        this.cellObjectRefs = cellObjectRefs;
        this.cellParentEdges = cellParentEdges;
        this.outPortRef = outPortRef;
        /**
         * Item id -> {gap, type}, in file order (output edge first).
         * @type {Map<number, {gap: number, type: number}>}
         */
        this.items = new Map();
    }
}

/**
 * Draws the items riding transport lanes. The sim sends a lane's shape whenever it is rebuilt and
 * one row per item whose spacing changed; this walks each lane's file to turn those gaps into
 * tiles, and drives the shared item layer.
 */
export class LaneItemDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ItemDrawLayer} itemLayer
     */
    constructor(itemLayer) {
        super();
        this._itemLayer = itemLayer;
        /**
         * @type {Map<number, LaneRecord>}
         * @private
         */
        this._lanes = new Map();
        // Lane id by the out-port id it rests items in, so a port-item event finds its lane.
        this._laneByOutPort = new Map();
    }

    get layerIndex() {
        // Draws nothing of its own; it drives the item layer, and sits with it.
        return 15;
    }

    get eventClasses() {
        return [
            LaneGeometryEvent,
            LaneItemUpsertEvent,
            LaneItemSyncEvent,
            LaneItemDeleteEvent,
            LaneItemResetEvent,
            PortItemSetEvent,
            PortItemClearEvent,
        ];
    }

    /**
     * The edge a lane cell is fed over, in the cell's own frame, or null when no lane covers it.
     * A mod's own draw layer reads a cell's bend from the sim's choice rather than re-deriving it.
     * @param {number} objectId
     * @returns {Direction|null}
     */
    parentEdgeOf(objectId) {
        for (const lane of this._lanes.values()) {
            const index = lane.cellObjectRefs.indexOf(objectId);
            if (index >= 0) {
                return lane.cellParentEdges[index];
            }
        }
        return null;
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof LaneGeometryEvent) {
            this._setGeometry(event);
            return;
        }
        if (event instanceof LaneItemResetEvent) {
            this._forget(event.laneRef);
            return;
        }
        if (event instanceof LaneItemUpsertEvent || event instanceof LaneItemSyncEvent) {
            this._upsert(event, event instanceof LaneItemSyncEvent);
            return;
        }
        if (event instanceof LaneItemDeleteEvent) {
            this._delete(event);
            return;
        }
        this._portItem(event);
    }

    /**
     * @private
     * @param {LaneGeometryEvent} event
     * @returns {void}
     */
    _setGeometry(event) {
        this._forget(event.laneRef);
        this._lanes.set(event.laneRef, new LaneRecord(event.cellObjectRefs, event.cellParentEdges, event.outPortRef));
        this._laneByOutPort.set(event.outPortRef, event.laneRef);
    }

    /**
     * Drops every sprite a lane owns; its rows arrive again with its next geometry.
     * @private
     * @param {number} laneRef
     * @returns {void}
     */
    _forget(laneRef) {
        const lane = this._lanes.get(laneRef);
        if (lane === undefined) {
            return;
        }
        for (const itemRef of lane.items.keys()) {
            this._itemLayer.removeItem(LANE_SPRITE_KEY(laneRef, itemRef));
        }
        this._itemLayer.removeItem(LANE_PORT_SPRITE_KEY(lane.outPortRef));
        this._laneByOutPort.delete(lane.outPortRef);
        this._lanes.delete(laneRef);
    }

    /**
     * @private
     * @param {LaneItemUpsertEvent|LaneItemSyncEvent} event
     * @param {boolean} snap - the row was re-synced rather than moved
     * @returns {void}
     */
    _upsert(event, snap) {
        const lane = this._lanes.get(event.laneRef);
        if (lane === undefined) {
            return;
        }
        lane.items.set(event.itemRef, {gap: event.gap, type: event.itemTypeId});
        this._redraw(event.laneRef, lane, snap);
    }

    /**
     * @private
     * @param {LaneItemDeleteEvent} event
     * @returns {void}
     */
    _delete(event) {
        const lane = this._lanes.get(event.laneRef);
        if (lane === undefined) {
            return;
        }
        lane.items.delete(event.itemRef);
        this._itemLayer.removeItem(LANE_SPRITE_KEY(event.laneRef, event.itemRef));
        this._redraw(event.laneRef, lane, false);
    }

    /**
     * The item resting past a lane's tail, which the engine renders as an ordinary port item.
     * @private
     * @param {PortItemSetEvent|PortItemClearEvent} event
     * @returns {void}
     */
    _portItem(event) {
        const laneRef = this._laneByOutPort.get(event.portId);
        if (laneRef === undefined) {
            return;
        }
        if (event instanceof PortItemClearEvent) {
            this._itemLayer.removeItem(LANE_PORT_SPRITE_KEY(event.portId));
            return;
        }
        const lane = this._lanes.get(laneRef);
        const slots = this._slotsOf(lane);
        if (slots === null) {
            return;
        }
        this._drawAt(LANE_PORT_SPRITE_KEY(event.portId), lane, slots, slots.total - 1, event.itemTypeId, false);
    }

    /**
     * The lane's cells with their tiles and how many slots each holds, or null while a cell is
     * still missing from the object index.
     * @private
     * @param {LaneRecord} lane
     * @returns {{cells: CacheEntry[], slots: number[], offsets: number[], total: number}|null}
     */
    _slotsOf(lane) {
        const cells = [];
        const slots = [];
        const offsets = [];
        let total = 0;
        for (const objectId of lane.cellObjectRefs) {
            const entry = this.cache.get(objectId);
            if (entry === null) {
                return null;
            }
            cells.push(entry);
            offsets.push(total);
            slots.push(entry.data.type.behavior.slotsPerTile);
            total += entry.data.type.behavior.slotsPerTile;
        }
        return {cells, slots, offsets, total};
    }

    /**
     * Walks a lane's file, turning each item's gap into the slot it stands on.
     * @private
     * @param {number} laneRef
     * @param {LaneRecord} lane
     * @param {boolean} snap
     * @returns {void}
     */
    _redraw(laneRef, lane, snap) {
        const slots = this._slotsOf(lane);
        if (slots === null) {
            return;
        }
        let filePos = 0;
        for (const [itemRef, item] of lane.items) {
            filePos += item.gap;
            this._drawAt(LANE_SPRITE_KEY(laneRef, itemRef), lane, slots, slots.total - 2 - filePos, item.type, snap);
            filePos += 1;
        }
    }

    /**
     * @private
     * @param {string} key
     * @param {LaneRecord} lane
     * @param {{cells: CacheEntry[], slots: number[], offsets: number[], total: number}} slots
     * @param {number} physical - the slot counted from the lane's input edge
     * @param {number} itemTypeId
     * @param {boolean} snap
     * @returns {void}
     */
    _drawAt(key, lane, slots, physical, itemTypeId, snap) {
        let index = slots.cells.length - 1;
        while (index > 0 && slots.offsets[index] > physical) {
            index -= 1;
        }
        const cell = slots.cells[index];
        const entering = Direction.rotate(lane.cellParentEdges[index], cell.data.direction);
        this._itemLayer.moveItem({
            key,
            tileX: cell.tileX,
            tileY: cell.tileY,
            // The first slot of a cell sits on the edge it takes flow over; the rest ride its center.
            halfTile: physical === slots.offsets[index],
            sourceDirection: Direction.invert(entering),
            type: itemTypeId,
            snap,
        });
    }
}
