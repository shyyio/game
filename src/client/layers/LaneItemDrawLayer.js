import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {Direction} from "@/common/constants.js";
import {LANE_LEVEL_SURFACE} from "@/sim/LaneIndex.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import {
    LaneGeometryEvent,
    LaneItemUpsertEvent,
    LaneItemSyncEvent,
    LaneItemDeleteEvent,
    LaneItemResetEvent,
} from "@/common/LaneEvents.js";

// Item sprite keys, namespaced away from the port keys sharing the item layer.
const LANE_SPRITE_KEY = (laneRef, itemRef) => `lane:${laneRef}:${itemRef}`;
const LANE_PORT_SPRITE_KEY = portRef => `lanePort:${portRef}`;

/**
 * One lane as the client knows it: the cells the sim last told it about, and the item rows riding
 * them.
 */
class LaneRecord {

    /**
     * @param {number[]} cellObjectRefs - head first
     * @param {Direction[]} cellParentEdges - the edge each cell is fed over, in its own frame
     * @param {number} outputPortRef
     */
    constructor(cellObjectRefs, cellParentEdges, outputPortRef) {
        this.cellObjectRefs = cellObjectRefs;
        this.cellParentEdges = cellParentEdges;
        this.outputPortRef = outputPortRef;
        /**
         * Item id -> {gap, type}, in file order (output edge first).
         * @type {Map<number, {gap: number, type: number}>}
         */
        this.items = new Map();
        // A lead was popped and its output port sprite has yet to appear, so that one glides in.
        this.popPending = false;
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
        // Lane id by the output port ref it rests items in, so a port-item event finds its lane.
        this._laneByOutputPort = new Map();
        // Lane id by cell, so a cell cached after its lane's rows redraws them.
        this._laneByCell = new Map();
        // The item resting in each port, by port ref: a rebuilt lane keeps its output port's item
        // without the sim resending it.
        this._portItems = new Map();
    }

    /**
     * A lane's rows can land before its newest cell: redraw the lane once the cell is cached.
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheSet(entry) {
        const laneRef = this._laneByCell.get(entry.id);
        if (laneRef === undefined) {
            return;
        }
        const lane = this._lanes.get(laneRef);
        this._redraw(laneRef, lane, true);
        this._drawPortItem(lane, true);
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
        const lane = new LaneRecord(event.cellObjectRefs, event.cellParentEdges, event.outputPortRef);
        this._lanes.set(event.laneRef, lane);
        this._laneByOutputPort.set(event.outputPortRef, event.laneRef);
        for (const objectRef of event.cellObjectRefs) {
            this._laneByCell.set(objectRef, event.laneRef);
        }
        this._drawPortItem(lane, true);
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
        this._itemLayer.removeItem(LANE_PORT_SPRITE_KEY(lane.outputPortRef));
        this._laneByOutputPort.delete(lane.outputPortRef);
        for (const objectRef of lane.cellObjectRefs) {
            this._laneByCell.delete(objectRef);
        }
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
        // An item leaves a lane only by popping into its output port.
        lane.popPending = true;
        this._redraw(event.laneRef, lane, false);
    }

    /**
     * The item resting in a lane's output port: drawn one tile past the tail on the edge facing back
     * at it, gliding in when a pop put it there, and a consumed one glides on into the consumer.
     * @private
     * @param {PortItemSetEvent|PortItemClearEvent} event
     * @returns {void}
     */
    _portItem(event) {
        if (event instanceof PortItemSetEvent) {
            this._portItems.set(event.portRef, event.itemTypeId);
        } else {
            this._portItems.delete(event.portRef);
        }
        const laneRef = this._laneByOutputPort.get(event.portRef);
        if (laneRef === undefined) {
            return;
        }
        const lane = this._lanes.get(laneRef);
        if (event instanceof PortItemSetEvent) {
            this._drawPortItem(lane, !lane.popPending);
            lane.popPending = false;
            return;
        }
        const key = LANE_PORT_SPRITE_KEY(event.portRef);
        const tail = this.cache.get(lane.cellObjectRefs[lane.cellObjectRefs.length - 1]);
        if (event.consumed === 1 && tail !== null) {
            this._itemLayer.consumeItem(key, Direction.invert(tail.data.direction));
            return;
        }
        this._itemLayer.removeItem(key);
    }

    /**
     * Places the sprite of the item resting in a lane's output port, if any; nothing while the tail
     * cell is still missing from the object index.
     * @private
     * @param {LaneRecord} lane
     * @param {boolean} snap - the item did not move, so its sprite must not glide
     * @returns {void}
     */
    _drawPortItem(lane, snap) {
        const itemTypeId = this._portItems.get(lane.outputPortRef);
        if (itemTypeId === undefined) {
            return;
        }
        const tail = this.cache.get(lane.cellObjectRefs[lane.cellObjectRefs.length - 1]);
        if (tail === null) {
            return;
        }
        const direction = tail.data.direction;
        this._itemLayer.moveItem({
            key: LANE_PORT_SPRITE_KEY(lane.outputPortRef),
            tileX: tail.tileX + Direction.dx(direction),
            tileY: tail.tileY + Direction.dy(direction),
            halfTile: true,
            sourceDirection: Direction.invert(direction),
            type: itemTypeId,
            snap,
        });
    }

    /**
     * The lane's cells with their tiles and how many slots each holds, or null while a cell is
     * still missing from the object index.
     * @private
     * @param {LaneRecord} lane
     * @returns {{cells: CacheEntry[], slots: number[], offsets: number[], total: number}|null}
     */
    _getSlotsByLane(lane) {
        const cells = [];
        const slots = [];
        const offsets = [];
        let total = 0;
        for (const objectRef of lane.cellObjectRefs) {
            const entry = this.cache.get(objectRef);
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
        const slots = this._getSlotsByLane(lane);
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
     * A cell's slots run from its center to the edge it hands flow over, so a lane's file is drawn
     * center, edge, center, edge... and its last slot is the output port past the tail.
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
        // A cell's last slot is the edge into the next cell: drawn there, on the edge it enters over.
        const halfTile = physical === slots.offsets[index] + slots.slots[index] - 1;
        if (halfTile) {
            index += 1;
        }
        const cell = slots.cells[index];
        const behavior = cell.data.type.behavior;
        const entering = Direction.rotate(lane.cellParentEdges[index], cell.data.direction);
        let hidden = behavior.inLevel < LANE_LEVEL_SURFACE;
        if (!halfTile) {
            // A center is under cover only while the cell is buried at both ends.
            hidden = hidden && behavior.outLevel < LANE_LEVEL_SURFACE;
        }
        this._itemLayer.moveItem({
            key,
            tileX: cell.tileX,
            tileY: cell.tileY,
            halfTile,
            sourceDirection: Direction.invert(entering),
            type: itemTypeId,
            snap,
            hidden,
        });
    }
}
