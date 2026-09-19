import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {Direction} from "@/common/constants.js";
import {LANE_LEVEL_SURFACE} from "@/sim/LaneIndex.js";
import {buildLanePath} from "@/client/layers/LanePath.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import {
    LaneCreatedEvent,
    LaneItemUpsertEvent,
    LaneItemSyncEvent,
    LaneItemDeleteEvent,
    LaneDeletedEvent,
} from "@/common/LaneEvents.js";

// Item sprite keys, namespaced away from the port keys sharing the item layer.
const LANE_SPRITE_KEY = (laneRef, itemRef) => `lane:${laneRef}:${itemRef}`;
const LANE_PORT_SPRITE_KEY = portRef => `lanePort:${portRef}`;

/**
 * One item resting in a lane's output port: what it is and when it was made.
 */
class PortItemEntry {

    /**
     * @param {number} itemTypeId
     * @param {number} birthTick
     */
    constructor(itemTypeId, birthTick) {
        this.itemTypeId = itemTypeId;
        this.birthTick = birthTick;
    }
}

/**
 * One item row as the client knows it: where it stands in the file, what it is, and when it was
 * made.
 */
class LaneItemEntry {

    /**
     * @param {number} gap - empty slots ahead of it
     * @param {number} itemTypeId
     * @param {number} birthTick
     */
    constructor(gap, itemTypeId, birthTick) {
        this.gap = gap;
        this.itemTypeId = itemTypeId;
        this.birthTick = birthTick;
    }
}

/**
 * One lane as the client knows it: the cells the sim last told it about, and the item rows riding
 * them.
 */
class LaneEntry {

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
         * @type {Map<number, LaneItemEntry>}
         */
        this.items = new Map();
        // A lead was popped and its output port sprite has yet to appear, so that one glides in.
        this.popPending = false;
        /**
         * The lane's slots and the line they stand on, built once every cell is cached.
         * @type {LaneSlots|null}
         */
        this.slots = null;
    }
}

/**
 * A lane's slots: how many each cell holds, and where each one stands along the line the cells
 * trace. Pure rebuild-time topology, so it is built once per lane geometry.
 */
export class LaneSlots {

    /**
     * @param {Object} lane
     * @param {CacheEntry[]} lane.cells - head first
     * @param {number[]} lane.slots - slots per cell
     * @param {number[]} lane.offsets - each cell's first slot
     * @param {number} lane.total
     * @param {LanePath} lane.path
     */
    constructor({cells, slots, offsets, total, path}) {
        this.cells = cells;
        this.slots = slots;
        this.offsets = offsets;
        this.total = total;
        this.path = path;
        /**
         * Each slot's distance along the path: an edge slot where the next cell's stretch starts,
         * a center slot halfway along its own, which in a cell items turn in is a point on the arc
         * rather than the tile center.
         * @type {number[]}
         */
        this.distances = [];
        for (let index = 0; index < cells.length; index += 1) {
            const center = path.getDistanceByCellIndex(index) + path.getLengthByCellIndex(index) / 2;
            for (let slot = 0; slot < slots[index]; slot += 1) {
                this.distances.push(center);
            }
            // A cell's last slot is the edge into the next cell.
            this.distances[this.distances.length - 1] = path.getDistanceByCellIndex(index + 1);
        }
    }

    /**
     * The cell a slot stands in.
     * @param {number} physical - the slot counted from the lane's input edge
     * @returns {number}
     */
    getCellIndexBySlot(physical) {
        let index = this.cells.length - 1;
        while (index > 0 && this.offsets[index] > physical) {
            index -= 1;
        }
        return index;
    }

    /**
     * Whether a slot is its cell's last, the edge into the next cell.
     * @param {number} index - the cell the slot stands in
     * @param {number} physical
     * @returns {boolean}
     */
    isEdgeSlot(index, physical) {
        return physical === this.offsets[index] + this.slots[index] - 1;
    }

    /**
     * Where a slot stands along the path; the slot before the lane's first is its input edge.
     * @param {number} physical
     * @returns {number}
     */
    getDistanceBySlot(physical) {
        if (physical < 0) {
            return 0;
        }
        return this.distances[physical];
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
         * @type {Map<number, LaneEntry>}
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
        // The replaced cell is one of the entries the slots were built over.
        lane.slots = null;
        this._drawLane(laneRef, lane, true);
        this._drawPortItem(lane, true);
    }

    get layerIndex() {
        // Draws nothing of its own; it drives the item layer, and sits with it.
        return 15;
    }

    get eventClasses() {
        return [
            LaneCreatedEvent,
            LaneItemUpsertEvent,
            LaneItemSyncEvent,
            LaneItemDeleteEvent,
            LaneDeletedEvent,
            PortItemSetEvent,
            PortItemClearEvent,
        ];
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof LaneCreatedEvent) {
            this._addLane(event);
            return;
        }
        if (event instanceof LaneDeletedEvent) {
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
     * @param {LaneCreatedEvent} event
     * @returns {void}
     */
    _addLane(event) {
        this._forget(event.laneRef);
        const lane = new LaneEntry(event.cellObjectRefs, event.cellParentEdges, event.outputPortRef);
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
        lane.items.set(event.itemRef, new LaneItemEntry(event.gap, event.itemTypeId, event.birthTick));
        this._drawLane(event.laneRef, lane, snap);
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
        this._drawLane(event.laneRef, lane, false);
    }

    /**
     * The item resting in a lane's output port: drawn at the end of the lane's path, gliding in
     * when a pop put it there, and a consumed one glides on into the consumer.
     * @private
     * @param {PortItemSetEvent|PortItemClearEvent} event
     * @returns {void}
     */
    _portItem(event) {
        if (event instanceof PortItemSetEvent) {
            this._portItems.set(event.portRef, new PortItemEntry(event.itemTypeId, event.birthTick));
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
     * Places the sprite of the item resting in a lane's output port, if any; nothing while a cell
     * is still missing from the object index.
     * @private
     * @param {LaneEntry} lane
     * @param {boolean} snap - the item did not move, so its sprite must not glide
     * @returns {void}
     */
    _drawPortItem(lane, snap) {
        const item = this._portItems.get(lane.outputPortRef);
        if (item === undefined) {
            return;
        }
        const slots = this._getSlotsByLane(lane);
        if (slots === null) {
            return;
        }
        // The port's resting spot is the tail's output edge, which is where the path ends, so an
        // item popping into it rides the tail's own curve on the way.
        this._itemLayer.moveItemAlong({
            key: LANE_PORT_SPRITE_KEY(lane.outputPortRef),
            path: slots.path,
            distance: slots.path.length,
            entryDistance: slots.getDistanceBySlot(slots.total - 2),
            type: item.itemTypeId,
            birthTick: item.birthTick,
            snap,
        });
    }

    /**
     * The lane's cells with their tiles and how many slots each holds, or null while a cell is
     * still missing from the object index.
     * @private
     * @param {LaneEntry} lane
     * @returns {LaneSlots|null}
     */
    _getSlotsByLane(lane) {
        if (lane.slots !== null) {
            return lane.slots;
        }
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
        const incomings = [];
        for (let i = 0; i < cells.length; i += 1) {
            incomings.push(Direction.toWorld(lane.cellParentEdges[i], cells[i].data.direction));
        }
        lane.slots = new LaneSlots({
            cells,
            slots,
            offsets,
            total,
            path: buildLanePath(cells, incomings),
        });
        return lane.slots;
    }

    /**
     * Walks a lane's file, turning each item's gap into the slot it stands on.
     * @private
     * @param {number} laneRef
     * @param {LaneEntry} lane
     * @param {boolean} snap
     * @returns {void}
     */
    _drawLane(laneRef, lane, snap) {
        const slots = this._getSlotsByLane(lane);
        if (slots === null) {
            return;
        }
        let filePos = 0;
        for (const [itemRef, item] of lane.items) {
            filePos += item.gap;
            this._drawAt(LANE_SPRITE_KEY(laneRef, itemRef), slots, slots.total - 2 - filePos, item, snap);
            filePos += 1;
        }
    }

    /**
     * A cell's slots run from its center to the edge it hands flow over, so a lane's file is drawn
     * center, edge, center, edge... and its last slot is the output port past the tail.
     * @private
     * @param {string} key
     * @param {LaneSlots} slots
     * @param {number} physical - the slot counted from the lane's input edge
     * @param {LaneItemEntry} item
     * @param {boolean} snap
     * @returns {void}
     */
    _drawAt(key, slots, physical, item, snap) {
        let index = slots.getCellIndexBySlot(physical);
        // A cell's last slot is the edge into the next cell: drawn there, on the edge it enters over.
        const halfTile = slots.isEdgeSlot(index, physical);
        if (halfTile) {
            index += 1;
        }
        const cell = slots.cells[index];
        const behavior = cell.data.type.behavior;
        let isHidden = behavior.inLevel < LANE_LEVEL_SURFACE;
        if (!halfTile) {
            // A center is under cover only while the cell is buried at both ends.
            isHidden = isHidden && behavior.outLevel < LANE_LEVEL_SURFACE;
        }
        this._itemLayer.moveItemAlong({
            key,
            path: slots.path,
            distance: slots.getDistanceBySlot(physical),
            entryDistance: slots.getDistanceBySlot(physical - 1),
            type: item.itemTypeId,
            birthTick: item.birthTick,
            snap,
            isHidden,
        });
    }
}
