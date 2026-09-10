import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {chunkKeyAt} from "@/common/util.js";
import {portAt} from "@/common/portGeometry.js";
import {
    LaneCreatedEvent,
    LaneSyncBatchEvent,
    LaneItemBatchEvent,
} from "@/common/LaneEvents.js";
import {AbstractSystem} from "@/sim/AbstractSystem.js";
import {LaneComponent} from "@/sim/LaneComponent.js";
import {LaneCellComponent} from "@/sim/LaneCellComponent.js";
import {LaneItemComponent} from "@/sim/LaneItemComponent.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";

// The level a lane cell takes flow from or gives it to: 0 is the surface, negative is buried,
// positive is elevated.
export const LANE_LEVEL_BURIED = -1;
export const LANE_LEVEL_SURFACE = 0;
export const LANE_LEVEL_ELEVATED_1 = 1;
export const LANE_LEVEL_ELEVATED_2 = 2;

// Lookup answer for a cell, tile or port that belongs to no lane.
export const NO_LANE = -1;

// Scratch value for a lane that submitted no intent this tick.
const NO_INTENT = -1;

// Every level that exists and the one fact the core holds about each: an axis-split level takes a
// layer per axis, so two lanes cross on one tile and neither bends; an unsplit level takes one
// layer, so lanes there bend freely but two of them cannot share a tile. Adding a level is one row.

// Should have a type here, not an anonymous list of 
const LANE_LEVELS = new Map([
    // No need for this to be abbreviated...
    [LANE_LEVEL_BURIED, {axisSplit: true, layers: ["LB_H", "LB_V"]}],
    [LANE_LEVEL_SURFACE, {axisSplit: false, layers: [LAYER_SURFACE]}],
    [LANE_LEVEL_ELEVATED_1, {axisSplit: false, layers: ["LE1"]}],
    [LANE_LEVEL_ELEVATED_2, {axisSplit: false, layers: ["LE2"]}],
]);

/**
 * The occupancy layer of `level`, for a cell running `direction`.
 * @param {number} level - LANE_LEVEL_*
 * @param {Direction} direction
 * @returns {string}
 */
export function getLaneLevelLayer(level, direction) {
    const entry = LANE_LEVELS.get(level);
    if (entry === undefined) {
        throw new Error(`No lane level ${level}`);
    }
    if (!entry.axisSplit) {
        return entry.layers[0];
    }
    // Should be Direction.axis(direction)
    const vertical = direction === Direction.UP || direction === Direction.DOWN;
    const axis = vertical ? 1 : 0;
    return entry.layers[axis];
}

/**
 * The layer a cell taking flow at `inLevel` and giving it at `outLevel` occupies. A cell off the
 * surface at both ends sits on its level's layer; every other cell, ramps included, on the surface.
 * @param {number} inLevel
 * @param {number} outLevel
 * @param {Direction} direction
 * @returns {string}
 */
export function getLaneCellLayer(inLevel, outLevel, direction) {
    if (inLevel !== outLevel || inLevel === LANE_LEVEL_SURFACE) {
        return LAYER_SURFACE;
    }
    return getLaneLevelLayer(inLevel, direction);
}

/**
 * Whether flow leaving at (outLevel, outDirection) meets flow taken at (inLevel, inDirection): the
 * same level, and the same axis where that level is split.
 * @param {number} outLevel
 * @param {Direction} outDirection
 * @param {number} inLevel
 * @param {Direction} inDirection
 * @returns {boolean}
 */
function shouldConnectLevels(outLevel, outDirection, inLevel, inDirection) {
    if (outLevel !== inLevel) {
        return false;
    }
    return getLaneLevelLayer(outLevel, outDirection) === getLaneLevelLayer(inLevel, inDirection);
}

export class LaneIndex extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        super();
        this.engine = engine;

        this.items = engine.components.register(new LaneItemComponent());

        this.lanes = engine.components.register(new LaneComponent());
        this.cells = engine.components.register(new LaneCellComponent());

        for (const level of LANE_LEVELS.values()) {
            for (const layer of level.layers) {
                engine.space.registerLayer(layer);
            }
        }

        // chunk -> its lanes, so the client feed and chunk sync skip the rest of the world.
        this._lanesByChunk = new Map();
        // This pass's client rows, one batch per chunk.
        this._batches = new Map();

        // Per-lane-row intents submitted this tick, and the item each would take onto the lane.
        this._popIntent = new Int32Array(0);
        this._drainIntent = new Int32Array(0);
        this._popSourceItem = new Int32Array(0);
        this._drainItem = new Int32Array(0);
    }

    /**
     * @param {number} eid - a lane cell
     * @returns {number} its lane, NO_LANE when it is in none
     */
    getLaneRefByCellEid(eid) {
        if (eid === NO_EID) {
            return NO_LANE;
        }
        const cellRow = this.cells.getRowByEid(eid);
        if (cellRow < 0) {
            return NO_LANE;
        }
        const laneEid = this.cells.store.lane[cellRow];
        if (laneEid === NO_EID) {
            return NO_LANE;
        }
        return laneEid;
    }

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} layer
     * @returns {number} the lane covering that cell, NO_LANE when none
     */
    getLaneRefAt(tileX, tileY, layer) {
        return this.getLaneRefByCellEid(this.engine.placed.getEidAt(tileX, tileY, layer));
    }

    /**
     * @returns {number[]} every live lane id
     */
    getLaneRefs() {
        return Array.from(this.lanes.getLiveEids());
    }

    /**
     * @param {number} laneRef
     * @returns {number[]} cell eids, head first
     */
    getCellEidsByLaneRef(laneRef) {
        const cells = [];
        let eid = this.lanes.store.headCell[this._getLaneRowByLaneRef(laneRef)];
        while (eid !== NO_EID) {
            cells.push(eid);
            eid = this.cells.store.childCell[this.cells.getRowByEid(eid)];
        }
        return cells;
    }

    /**
     * @param {number} laneRef
     * @returns {number} slots
     */
    getSlotCountByLaneRef(laneRef) {
        return this.lanes.store.slotCount[this._getLaneRowByLaneRef(laneRef)];
    }

    /**
     * @param {number} laneRef
     * @returns {number} port eid
     */
    getInputPortEidByLaneRef(laneRef) {
        return this.lanes.store.inputPort[this._getLaneRowByLaneRef(laneRef)];
    }

    /**
     * @param {number} laneRef
     * @returns {number} port eid
     */
    getOutputPortEidByLaneRef(laneRef) {
        return this.lanes.store.outputPort[this._getLaneRowByLaneRef(laneRef)];
    }

    /**
     * @param {number} laneRef
     * @returns {{itemRef: number, itemTypeId: number, gap: number}[]} output-edge first
     */
    getItemsByLaneRef(laneRef) {
        const store = this.items.store;
        return this.items.getFileByFirstItemEid(this.lanes.store.firstItem[this._getLaneRowByLaneRef(laneRef)]).map(itemEid => {
            const itemRow = this.items.getRowByEid(itemEid);
            return {itemRef: store.itemRef[itemRow], itemTypeId: store.itemTypeId[itemRow], gap: store.gap[itemRow]};
        });
    }

    /**
     * The edge flow reaches a cell over, in the cell's own frame: UP is its straight back edge.
     * @param {number} eid - a lane cell
     * @returns {Direction}
     */
    getParentEdgeByCellEid(eid) {
        const cellRow = this.cells.getRowByEid(eid);
        if (cellRow < 0) {
            throw new Error(`Entity ${eid} is no lane cell`);
        }
        return this.cells.store.parentEdge[cellRow];
    }

    /**
     * @private
     * @param {number} laneRef
     * @returns {Direction[]} one per cell, head first
     */
    _getParentEdgesByLaneRef(laneRef) {
        return this.getCellEidsByLaneRef(laneRef).map(cell => this.cells.store.parentEdge[this.cells.getRowByEid(cell)]);
    }

    /**
     * @param {number} laneRef
     * @returns {number}
     */
    getItemCountByLaneRef(laneRef) {
        return this.lanes.store.itemCount[this._getLaneRowByLaneRef(laneRef)];
    }

    /**
     * @private
     * @param {number} laneRef
     * @returns {number} its column laneRow
     */
    _getLaneRowByLaneRef(laneRef) {
        const laneRow = this.lanes.getRowByEid(laneRef);
        if (laneRow < 0) {
            throw new Error(`No lane ${laneRef}`);
        }
        return laneRow;
    }

    /**
     * @private
     * @param {number} eid - a lane cell
     * @returns {LaneBehavior}
     */
    _getBehaviorByCellEid(eid) {
        return this.engine.placed.getBehaviorByTypeId(this.engine.placed.getObjectTypeIdByEid(eid));
    }

    /**
     * The shared edge past a cell's output side.
     * @private
     * @param {number} eid
     * @returns {number} port eid
     */
    _getOutputPortEidByCellEid(eid) {
        const position = this.engine.Position;
        const direction = position.direction[eid];
        return this.engine.ports.getPortEidAt(
            position.x[eid] + Direction.dx(direction),
            position.y[eid] + Direction.dy(direction),
            direction,
        );
    }

    /**
     * The shared edge behind a cell, which is its lane's input port when it heads one.
     * @private
     * @param {number} eid
     * @returns {number} port eid
     */
    _getInputPortEidByCellEid(eid) {
        const position = this.engine.Position;
        return this.engine.ports.getPortEidAt(position.x[eid], position.y[eid], position.direction[eid]);
    }

    /**
     // This sentence makes no sense. Doesn,t even seem related to the method name
     * The cell `eid`'s flow enters, NO_EID when nothing takes it.
     * @private
     * @param {number} eid
     * @returns {number}
     */
    _getChildByCellEid(eid) {
        const position = this.engine.Position;
        const direction = position.direction[eid];
        const outLevel = this._getBehaviorByCellEid(eid).outLevel;
        for (const candidate of this.engine.ports.getConsumerEidsByPortEid(this._getOutputPortEidByCellEid(eid))) {
            if (this.cells.getRowByEid(candidate) < 0) {
                continue;
            }
            if (shouldConnectLevels(outLevel, direction, this._getBehaviorByCellEid(candidate).inLevel, position.direction[candidate])) {
                return candidate;
            }
        }
        return NO_EID;
    }

    /**
     * The level an object gives flow at; anything but a lane cell gives it on the surface.
     * @private
     * @param {number} eid
     * @returns {number}
     */
    _getOutLevelByCellEid(eid) {
        const behavior = this._getBehaviorByCellEid(eid);
        if (behavior.outLevel === undefined) {
            return LANE_LEVEL_SURFACE;
        }
        return behavior.outLevel;
    }

    /**
     * Every adjacent object giving flow into one of `eid`'s declared input edges at its own level,
     * with the edge each of them hands it.
     * @private
     * @param {number} eid
     * @returns {{eids: number[], edges: {x: number, y: number, direction: Direction}[]}}
     */
    _getParentCandidatesByCellEid(eid) {
        const engine = this.engine;
        const position = engine.Position;
        const direction = position.direction[eid];
        const inLevel = this._getBehaviorByCellEid(eid).inLevel;
        const type = engine.placed.getObjectTypeByTypeId(engine.placed.getObjectTypeIdByEid(eid));
        const eids = [];
        const edges = [];
        for (const definition of type.getActivePortsByKind("inputPorts")) {
            const edge = portAt(definition, position.x[eid], position.y[eid], direction);
            for (const producer of engine.ports.getProducerEidsByPortEid(engine.ports.getPortEidAt(edge.x, edge.y, edge.direction))) {
                if (this._getOutLevelByCellEid(producer) === inLevel) {
                    eids.push(producer);
                    edges.push(edge);
                }
            }
        }
        return {eids, edges};
    }

    /**
     * The feed a cell takes: the edge its chooseParent winner hands it, in the cell's own frame, the
     * port on it, and the winner when it also continues a lane into the cell. A cell nothing feeds is
     * fed on its straight back edge.
     * @private
     * @param {number} eid
     * @returns {{edge: Direction, portEid: number, parent: number}}
     */
    _getParentLinkByCellEid(eid) {
        const position = this.engine.Position;
        const direction = position.direction[eid];
        const candidates = this._getParentCandidatesByCellEid(eid);
        if (candidates.eids.length === 0) {
            return {edge: Direction.UP, portEid: this._getInputPortEidByCellEid(eid), parent: NO_EID};
        }
        // A lane cell outranks any other object, so a machine beside a head never cuts the line behind it.
        let contenders = candidates.eids.filter(candidate => this.cells.getRowByEid(candidate) >= 0);
        if (contenders.length === 0) {
            contenders = candidates.eids;
        }
        const winner = this._getBehaviorByCellEid(eid).chooseParent(this.engine, contenders);
        const index = candidates.eids.indexOf(winner);
        const edge = candidates.edges[index];
        let parent = NO_EID;
        if (this.cells.getRowByEid(winner) >= 0
            && shouldConnectLevels(this._getOutLevelByCellEid(winner), position.direction[winner], this._getBehaviorByCellEid(eid).inLevel, direction)) {
            parent = winner;
        }
        return {
            edge: Direction.rotate(edge.direction, 4 - direction),
            portEid: this.engine.ports.getPortEidAt(edge.x, edge.y, edge.direction),
            parent,
        };
    }

    /**
     * The lane cells that feed `eid`, whose own lanes a change at `eid` can move.
     * @private
     * @param {number} eid
     * @returns {number[]}
     */
    _getParentCellEidsByCellEid(eid) {
        return this._getParentCandidatesByCellEid(eid).eids.filter(candidate => this.cells.getRowByEid(candidate) >= 0);
    }

    /**
     * The one parent that continues its lane into `eid`, NO_EID when it has none.
     * @private
     * @param {number} eid
     * @returns {number}
     */
    _getParentByCellEid(eid) {
        return this._getParentLinkByCellEid(eid).parent;
    }

    // ---- edits ----

    /**
     * Adopts a freshly placed cell and rebuilds the lanes its links change.
     * @param {number} eid
     * @returns {void}
     */
    addCell(eid) {
        this.cells.attach(eid);
        const affected = this._getAffectedCellEids(this._dirtyAround(eid));
        affected.add(eid);
        this._rebuildCells(affected, NO_EID);
    }

    /**
     * Re-derives the lanes an object's output edges feed, so a machine placed or taken away beside a
     * lane head moves that head's parent edge and input port with it. Lane cells come through
     * {@link addCell} and {@link removeCell} instead, and a lane whose feed is unchanged is left
     * alone rather than rebuilt.
     * @param {number} eid - the object spawned or being despawned
     * @returns {void}
     */
    onSpawn(eid) {
        this._objectChanged(eid);
    }

    onDespawn(eid) {
        this._objectChanged(eid);
    }

    /**
     * @private
     * @param {number} eid
     * @returns {void}
     */
    _objectChanged(eid) {
        if (this.cells.getRowByEid(eid) >= 0) {
            return;
        }
        const engine = this.engine;
        const position = engine.Position;
        const type = engine.placed.getObjectTypeByTypeId(engine.placed.getObjectTypeIdByEid(eid));
        const stale = new Set();
        for (const definition of type.getActivePortsByKind("outputPorts")) {
            const edge = portAt(definition, position.x[eid], position.y[eid], position.direction[eid]);
            for (const cell of engine.ports.getConsumerEidsByPortEid(engine.ports.getPortEidAt(edge.x, edge.y, edge.direction))) {
                const cellRow = this.cells.getRowByEid(cell);
                if (cellRow >= 0 && this._getParentLinkByCellEid(cell).edge !== this.cells.store.parentEdge[cellRow]) {
                    stale.add(cell);
                }
            }
        }
        if (stale.size === 0) {
            return;
        }
        this._rebuildCells(this._getAffectedCellEids(stale), NO_EID);
    }

    /**
     * Drops a cell being deleted and rebuilds what it was part of.
     * @param {number} eid
     * @returns {void}
     */
    removeCell(eid) {
        const dirty = this._dirtyAround(eid);
        dirty.delete(eid);
        const affected = this._getAffectedCellEids(dirty);
        const laneEid = this.getLaneRefByCellEid(eid);
        if (laneEid !== NO_LANE) {
            for (const cell of this.getCellEidsByLaneRef(laneEid)) {
                affected.add(cell);
            }
        }
        affected.delete(eid);
        this._rebuildCells(affected, eid);
    }

    /**
     * The cells whose parent or child link the change at `eid` can move.
     * @private
     * @param {number} eid
     * @returns {Set<number>}
     */
    _dirtyAround(eid) {
        const dirty = new Set([eid]);
        for (const parent of this._getParentCellEidsByCellEid(eid)) {
            dirty.add(parent);
        }
        const child = this._getChildByCellEid(eid);
        if (child !== NO_EID) {
            dirty.add(child);
            for (const parent of this._getParentCellEidsByCellEid(child)) {
                dirty.add(parent);
            }
        }
        return dirty;
    }

    /**
     * Every cell of every lane a dirty cell belongs to.
     * @private
     * @param {Set<number>} dirty
     * @returns {Set<number>}
     */
    _getAffectedCellEids(dirty) {
        const affected = new Set();
        for (const eid of dirty) {
            const laneEid = this.getLaneRefByCellEid(eid);
            if (laneEid === NO_LANE) {
                affected.add(eid);
                continue;
            }
            for (const cell of this.getCellEidsByLaneRef(laneEid)) {
                affected.add(cell);
            }
        }
        return affected;
    }

    /**
     * Tears the lanes covering `cells` down and derives them again, keeping every item on the slot
     * it stands on.
     * @private
     * @param {Set<number>} cells
     * @param {number} dropped - a cell being deleted, whose items are lost
     * @returns {void}
     */
    _rebuildCells(cells, dropped) {
        const itemSlotsByCellEid = new Map();
        const lanes = new Set();
        for (const eid of cells) {
            const laneEid = this.getLaneRefByCellEid(eid);
            if (laneEid !== NO_LANE) {
                lanes.add(laneEid);
            }
        }
        if (dropped !== NO_EID) {
            const laneEid = this.getLaneRefByCellEid(dropped);
            if (laneEid !== NO_LANE) {
                lanes.add(laneEid);
            }
        }
        for (const laneEid of lanes) {
            this._popItemsIntoCellSlots(laneEid, itemSlotsByCellEid);
            this._destroyLane(laneEid);
        }
        // The resets go out now: a rebuilt lane may take a destroyed one's eid, and the client
        // forgets a lane on its reset.
        this._flushBatches();
        this._destroyCellSlotItems(itemSlotsByCellEid.get(dropped));
        itemSlotsByCellEid.delete(dropped);

        const ordered = Array.from(cells).sort((a, b) => a - b);
        const built = [];
        for (const eid of ordered) {
            if (this.getLaneRefByCellEid(eid) !== NO_LANE) {
                continue;
            }
            built.push(this._buildLane(eid));
        }
        for (const laneEid of built) {
            this._pushItemsFromCellSlots(laneEid, itemSlotsByCellEid);
        }
        for (const items of itemSlotsByCellEid.values()) {
            this._destroyCellSlotItems(items);
        }
        for (const laneEid of built) {
            this._emitLaneCreated(laneEid);
            this._addLaneItemSyncs(laneEid);
        }
        this._flushBatches();
        // The port items the rebuild moved go out with its rows, not a render pass later.
        this.engine.render.emitPortItemBatch();
    }

    /**
     * Builds the maximal chain of links through `eid`, inside its chunk.
     * @private
     * @param {number} eid
     * @returns {number} the lane id
     */
    _buildLane(eid) {
        const chunkKey = this._getChunkKeyByEid(eid);
        const seen = new Set([eid]);
        let start = eid;
        for (;;) {
            const parent = this._getParentByCellEid(start);
            if (parent === NO_EID || seen.has(parent) || this._getChunkKeyByEid(parent) !== chunkKey) {
                break;
            }
            if (this.getLaneRefByCellEid(parent) !== NO_LANE) {
                break;
            }
            seen.add(parent);
            start = parent;
        }
        const cells = [];
        let cell = start;
        while (cell !== NO_EID) {
            cells.push(cell);
            const child = this._getChildByCellEid(cell);
            if (child === NO_EID || this._getChunkKeyByEid(child) !== chunkKey) {
                break;
            }
            if (this._getParentByCellEid(child) !== cell || cells.includes(child)) {
                break;
            }
            cell = child;
        }
        return this._createLane(cells);
    }

    /**
     * @private
     * @param {number} eid
     * @returns {number}
     */
    _getChunkKeyByEid(eid) {
        return chunkKeyAt(this.engine.Position.x[eid], this.engine.Position.y[eid]);
    }

    /**
     * @private
     * @param {number[]} cells - head first
     * @returns {number} the lane id
     */
    _createLane(cells) {
        const engine = this.engine;
        const laneEid = this.lanes.create();
        const laneRow = this.lanes.getRowByEid(laneEid);
        const lanes = this.lanes.store;
        const tail = cells[cells.length - 1];
        let slots = 0;
        for (let i = 0; i < cells.length; i += 1) {
            const cellRow = this.cells.getRowByEid(cells[i]);
            this.cells.store.lane[cellRow] = laneEid;
            const next = i + 1 < cells.length ? cells[i + 1] : NO_EID;
            this.cells.store.childCell[cellRow] = next;
            this.cells.store.parentEdge[cellRow] = this._getParentLinkByCellEid(cells[i]).edge;
            slots += this._getBehaviorByCellEid(cells[i]).slotsPerTile;
        }
        lanes.headCell[laneRow] = cells[0];
        lanes.outputPort[laneRow] = this._getOutputPortEidByCellEid(tail);
        lanes.inputPort[laneRow] = this._getParentLinkByCellEid(cells[0]).portEid;
        lanes.slotCount[laneRow] = slots - 1;
        lanes.itemCount[laneRow] = 0;
        lanes.headGap[laneRow] = slots - 1;
        lanes.firstItem[laneRow] = NO_EID;
        lanes.lastItem[laneRow] = NO_EID;
        lanes.nextItemRef[laneRow] = 1;
        const chunkKey = this._getChunkKeyByEid(cells[0]);
        let chunkLanes = this._lanesByChunk.get(chunkKey);
        if (chunkLanes === undefined) {
            chunkLanes = new Set();
            this._lanesByChunk.set(chunkKey, chunkLanes);
        }
        chunkLanes.add(laneEid);
        // The output port is the tail cell's last slot, so its input port item item draws on the tail's tile
        // and routes to the lane's own chunk.
        const position = engine.Position;
        engine.render.registerPort(lanes.outputPort[laneRow], position.x[tail], position.y[tail]);
        return laneEid;
    }

    /**
     * @private
     * @param {number} laneEid
     * @returns {void}
     */
    _destroyLane(laneEid) {
        const laneRow = this._getLaneRowByLaneRef(laneEid);
        const lanes = this.lanes.store;
        for (const cell of this.getCellEidsByLaneRef(laneEid)) {
            const cellRow = this.cells.getRowByEid(cell);
            this.cells.store.lane[cellRow] = NO_EID;
            this.cells.store.childCell[cellRow] = NO_EID;
        }
        this.engine.render.unregisterPort(lanes.outputPort[laneRow]);
        const chunkKey = this._getChunkKeyByEid(lanes.headCell[laneRow]);
        const chunkLanes = this._lanesByChunk.get(chunkKey);
        if (chunkLanes !== undefined) {
            chunkLanes.delete(laneEid);
            if (chunkLanes.size === 0) {
                this._lanesByChunk.delete(chunkKey);
            }
        }
        this._getBatchByChunkKey(chunkKey, lanes.headCell[laneRow]).addLaneDeleted(laneEid);
        this.engine.components.destroyEntity(laneEid);
    }

    /**
     * Pops every item off a lane's file into the slot it stands on, by cell.
     * @private
     * @param {number} laneEid
     * @param {Map<number, number[]>} itemSlotsByCellEid
     * @returns {void}
     */
    _popItemsIntoCellSlots(laneEid, itemSlotsByCellEid) {
        const laneRow = this._getLaneRowByLaneRef(laneEid);
        const cells = this.getCellEidsByLaneRef(laneEid);
        const slots = cells.map(cell => this._getBehaviorByCellEid(cell).slotsPerTile);
        let total = 0;
        for (const count of slots) {
            total += count;
        }
        const store = this.items.store;
        let slotFromOutput = 0;
        for (const itemEid of this.items.getFileByFirstItemEid(this.lanes.store.firstItem[laneRow])) {
            const itemRow = this.items.getRowByEid(itemEid);
            slotFromOutput += store.gap[itemRow];
            const slotFromInput = total - 2 - slotFromOutput;
            this._setCellSlotItem(itemSlotsByCellEid, cells, slots, slotFromInput, itemEid);
            slotFromOutput += 1;
            store.lane[itemRow] = NO_EID;
            store.nextItem[itemRow] = NO_EID;
        }
        this.lanes.store.firstItem[laneRow] = NO_EID;
        this.lanes.store.lastItem[laneRow] = NO_EID;
        this.lanes.store.itemCount[laneRow] = 0;
    }

    /**
     * @private
     * @param {Map<number, number[]>} itemSlotsByCellEid
     * @param {number[]} cells
     * @param {number[]} slots
     * @param {number} slotFromInput - the slot counted from the lane's input edge
     * @param {number} itemEid
     * @returns {void}
     */
    _setCellSlotItem(itemSlotsByCellEid, cells, slots, slotFromInput, itemEid) {
        let offset = slotFromInput;
        for (let i = 0; i < cells.length; i += 1) {
            if (offset < slots[i]) {
                let cellSlots = itemSlotsByCellEid.get(cells[i]);
                if (cellSlots === undefined) {
                    cellSlots = new Array(slots[i]).fill(NO_EID);
                    itemSlotsByCellEid.set(cells[i], cellSlots);
                }
                cellSlots[offset] = itemEid;
                return;
            }
            offset -= slots[i];
        }
        throw new Error(`Lane item at slot ${slotFromInput} stands on no cell`);
    }

    /**
     * Pushes the cell slots' items back onto a rebuilt lane, and creates an item from whatever
     * rests in an edge that is now interior to it.
     * @private
     * @param {number} laneEid
     * @param {Map<number, number[]>} itemSlotsByCellEid
     * @returns {void}
     */
    _pushItemsFromCellSlots(laneEid, itemSlotsByCellEid) {
        const cells = this.getCellEidsByLaneRef(laneEid);
        const slots = cells.map(cell => this._getBehaviorByCellEid(cell).slotsPerTile);
        for (let i = 1; i < cells.length; i += 1) {
            this._createItemFromInteriorPort(itemSlotsByCellEid, cells, slots, i);
        }
        const laneRow = this._getLaneRowByLaneRef(laneEid);
        const lanes = this.lanes.store;
        let total = 0;
        for (const count of slots) {
            total += count;
        }
        let slotFromInput = total - 1;
        let previous = -1;
        for (let i = cells.length - 1; i >= 0; i -= 1) {
            const items = itemSlotsByCellEid.get(cells[i]);
            for (let slot = slots[i] - 1; slot >= 0; slot -= 1) {
                const itemEid = items === undefined ? NO_EID : items[slot];
                const slotFromOutput = total - 2 - slotFromInput;
                slotFromInput -= 1;
                if (itemEid === NO_EID) {
                    continue;
                }
                items[slot] = NO_EID;
                if (slotFromOutput < 0) {
                    // The tail cell's last slot is the output port itself.
                    this.engine.ports.setItem(lanes.outputPort[laneRow], this.items.store.itemTypeId[this.items.getRowByEid(itemEid)]);
                    this.items.destroy(itemEid);
                    continue;
                }
                this._pushItem(laneEid, itemEid, slotFromOutput - previous - 1);
                previous = slotFromOutput;
            }
        }
        lanes.headGap[laneRow] = total - 1 - this._getUsedSlotsByLaneEid(laneEid);
    }

    /**
     * Creates an item from the one resting in the edge before cell `index`, which the rebuild made
     * interior, and clears the port. That
     * edge is where the upstream cell hands flow over, not cell `index`'s straight back edge: a bent
     * cell takes flow across a flank, and its back edge is a side input this lane never crosses.
     * @private
     * @param {Map<number, number[]>} itemSlotsByCellEid
     * @param {number[]} cells
     * @param {number[]} slots
     * @param {number} index
     * @returns {void}
     */
    _createItemFromInteriorPort(itemSlotsByCellEid, cells, slots, index) {
        const portEid = this._getOutputPortEidByCellEid(cells[index - 1]);
        const portItem = this.engine.ports.getItemByPortEid(portEid);
        if (portItem === EMPTY || this.engine.isFluid(portItem)) {
            return;
        }
        const slot = slots[index - 1] - 1;
        let cellSlots = itemSlotsByCellEid.get(cells[index - 1]);
        if (cellSlots === undefined) {
            cellSlots = new Array(slots[index - 1]).fill(NO_EID);
            itemSlotsByCellEid.set(cells[index - 1], cellSlots);
        }
        if (cellSlots[slot] !== NO_EID) {
            return;
        }
        cellSlots[slot] = this.items.create(portItem);
        this.engine.ports.setItem(portEid, EMPTY);
    }

    /**
     * @private
     * @param {number} laneEid
     * @returns {number} slots the file occupies, items and the gaps ahead of them
     */
    _getUsedSlotsByLaneEid(laneEid) {
        const laneRow = this._getLaneRowByLaneRef(laneEid);
        const store = this.items.store;
        let used = 0;
        for (const itemEid of this.items.getFileByFirstItemEid(this.lanes.store.firstItem[laneRow])) {
            used += store.gap[this.items.getRowByEid(itemEid)] + 1;
        }
        return used;
    }

    /**
     * Pushes an item onto the input end of a lane's file.
     * @private
     * @param {number} laneEid
     * @param {number} itemEid
     * @param {number} gap
     * @returns {void}
     */
    _pushItem(laneEid, itemEid, gap) {
        const laneRow = this._getLaneRowByLaneRef(laneEid);
        const lanes = this.lanes.store;
        const itemRow = this.items.getRowByEid(itemEid);
        this.items.store.lane[itemRow] = laneEid;
        this.items.store.nextItem[itemRow] = NO_EID;
        this.items.store.gap[itemRow] = gap;
        this.items.store.itemRef[itemRow] = lanes.nextItemRef[laneRow];
        lanes.nextItemRef[laneRow] += 1;
        if (lanes.firstItem[laneRow] === NO_EID) {
            lanes.firstItem[laneRow] = itemEid;
        } else {
            this.items.store.nextItem[this.items.getRowByEid(lanes.lastItem[laneRow])] = itemEid;
        }
        lanes.lastItem[laneRow] = itemEid;
        lanes.itemCount[laneRow] += 1;
    }

    // ---- the step ----

    /**
     * The pop past the tail and the push at the head.
     * @returns {void}
     */
    submitIntents() {
        const engine = this.engine;
        const lanes = this.lanes.store;
        const laneCount = this.lanes.count;
        this._growScratch(laneCount);
        const items = this.items.store;
        for (let laneRow = 0; laneRow < laneCount; laneRow += 1) {
            this._popIntent[laneRow] = NO_INTENT;
            this._drainIntent[laneRow] = NO_INTENT;
            const inputPort = lanes.inputPort[laneRow];
            const inputPortItemTypeId = engine.ports.getItemByPortEid(inputPort);
            // A lane has one input; a resting fluid is refused, so its producer backs up.
            const inputPortTakeable = inputPortItemTypeId !== EMPTY && !engine.isFluid(inputPortItemTypeId);
            const leadItem = lanes.firstItem[laneRow];
            if (leadItem !== NO_EID && items.gap[this.items.getRowByEid(leadItem)] === 0 && this._canPop(laneRow)) {
                this._submitPop(laneRow, inputPortItemTypeId, items.itemTypeId[this.items.getRowByEid(leadItem)]);
            }
            if (inputPortTakeable && lanes.itemCount[laneRow] < lanes.slotCount[laneRow]) {
                this._drainItem[laneRow] = inputPortItemTypeId;
                this._drainIntent[laneRow] = engine.transfers.submitDrain(inputPort);
            }
        }
    }

    /**
     * pop leadItem in output port, shift input port's item into lane
     * @private
     * @param {number} laneRow
     * @param {number} inputPortItemTypeId
     * @param {number} leadTypeId
     * @returns {void}
     */
    _submitPop(laneRow, inputPortItemTypeId, leadTypeId) {
        const lanes = this.lanes.store;
        const transfers = this.engine.transfers;
        const outputPort = lanes.outputPort[laneRow];
        const outputPortEmpty = this.engine.ports.getItemByPortEid(outputPort) === EMPTY;
        if (this.engine.isFluid(inputPortItemTypeId)) {
            this._popSourceItem[laneRow] = EMPTY;
            this._popIntent[laneRow] = transfers.submitCreate(outputPort, leadTypeId, outputPortEmpty);
            return;
        }
        this._popSourceItem[laneRow] = inputPortItemTypeId;
        this._popIntent[laneRow] = transfers.submitTransfer(lanes.inputPort[laneRow], outputPort, outputPortEmpty, EMPTY, leadTypeId);
    }

    /**
     * Whether the lead may leave this tick: never into a fluid port. Whether the output port empties,
     * by being empty or by whatever is past it taking its item, is the resolver's question.
     * @private
     * @param {number} laneRow
     * @returns {boolean}
     */
    _canPop(laneRow) {
        return !this.engine.ports.isFluidClaimed(this.lanes.store.outputPort[laneRow]);
    }

    /**
     * Advances every file by what its intents won, and takes in what its drain took.
     * @returns {void}
     */
    postResolve() {
        const transfers = this.engine.transfers;
        for (let laneRow = 0; laneRow < this.lanes.count; laneRow += 1) {
            const laneEid = this.lanes.eids[laneRow];
            const popped = this._popIntent[laneRow] !== NO_INTENT && transfers.isResolved(this._popIntent[laneRow]);
            let takenItem = EMPTY;
            if (popped) {
                this._popLead(laneEid, laneRow);
                takenItem = this._popSourceItem[laneRow];
            } else {
                this._shiftItems(laneEid, laneRow);
            }
            // The item enters once, whichever intent emptied the port.
            if (takenItem === EMPTY && this._drainIntent[laneRow] !== NO_INTENT && transfers.isResolved(this._drainIntent[laneRow])) {
                takenItem = this._drainItem[laneRow];
            }
            if (takenItem !== EMPTY) {
                this._pushItemFromInputPort(laneEid, laneRow, takenItem);
            }
        }
        this._flushBatches();
    }

    /**
     * Drops the lead item, which the pop moved into the output port; the rest of the file advances with
     * it, their stored gaps already correct.
     * @private
     * @param {number} laneEid
     * @param {number} laneRow
     * @returns {void}
     */
    _popLead(laneEid, laneRow) {
        const lanes = this.lanes.store;
        const leadItem = lanes.firstItem[laneRow];
        const itemRow = this.items.getRowByEid(leadItem);
        this._getBatchByLaneRow(laneRow).addDelete(laneEid, this.items.store.itemRef[itemRow]);
        lanes.firstItem[laneRow] = this.items.store.nextItem[itemRow];
        if (lanes.firstItem[laneRow] === NO_EID) {
            lanes.lastItem[laneRow] = NO_EID;
        }
        lanes.itemCount[laneRow] -= 1;
        lanes.headGap[laneRow] += 1;
        this.items.destroy(leadItem);
    }

    /**
     * Moves the file one slot: the first item with room ahead closes it, and everything behind
     * follows at its own spacing.
     * @private
     * @param {number} laneEid
     * @param {number} laneRow
     * @returns {void}
     */
    _shiftItems(laneEid, laneRow) {
        const items = this.items.store;
        let itemEid = this.lanes.store.firstItem[laneRow];
        while (itemEid !== NO_EID) {
            const itemRow = this.items.getRowByEid(itemEid);
            if (items.gap[itemRow] > 0) {
                items.gap[itemRow] -= 1;
                this.lanes.store.headGap[laneRow] += 1;
                this._getBatchByLaneRow(laneRow).addUpsert(laneEid, items.itemRef[itemRow], items.gap[itemRow], items.itemTypeId[itemRow]);
                return;
            }
            itemEid = items.nextItem[itemRow];
        }
    }

    /**
     * Pushes the item an intent took from the input port onto the lane.
     * @private
     * @param {number} laneEid
     * @param {number} laneRow
     * @param {number} itemTypeId
     * @returns {void}
     */
    _pushItemFromInputPort(laneEid, laneRow, itemTypeId) {
        const lanes = this.lanes.store;
        const itemEid = this.items.create(itemTypeId);
        this._pushItem(laneEid, itemEid, lanes.headGap[laneRow] - 1);
        lanes.headGap[laneRow] = 0;
        const itemRow = this.items.getRowByEid(itemEid);
        this._getBatchByLaneRow(laneRow).addUpsert(
            laneEid,
            this.items.store.itemRef[itemRow],
            this.items.store.gap[itemRow],
            this.items.store.itemTypeId[itemRow],
        );
    }

    /**
     * @private
     * @param {number} count
     * @returns {void}
     */
    _growScratch(count) {
        if (count <= this._popIntent.length) {
            return;
        }
        let capacity = Math.max(this._popIntent.length, 1);
        while (capacity < count) {
            capacity *= 2;
        }
        this._popIntent = new Int32Array(capacity);
        this._drainIntent = new Int32Array(capacity);
        this._popSourceItem = new Int32Array(capacity);
        this._drainItem = new Int32Array(capacity);
    }

    /**
     * @private
     * @param {number} laneRow - a lane's column laneRow
     * @returns {LaneItemBatchEvent}
     */
    _getBatchByLaneRow(laneRow) {
        const head = this.lanes.store.headCell[laneRow];
        return this._getBatchByChunkKey(this._getChunkKeyByEid(head), head);
    }

    /**
     * @private
     * @param {number} chunkKey
     * @param {number} eid - a cell in that chunk, positioning the batch
     * @returns {LaneItemBatchEvent}
     */
    _getBatchByChunkKey(chunkKey, eid) {
        const existing = this._batches.get(chunkKey);
        if (existing !== undefined) {
            return existing;
        }
        const position = this.engine.Position;
        const batch = new LaneItemBatchEvent(position.x[eid], position.y[eid]);
        this._batches.set(chunkKey, batch);
        return batch;
    }

    /**
     * @private
     * @returns {void}
     */
    _flushBatches() {
        for (const batch of this._batches.values()) {
            if (!batch.isEmpty && this.engine.isTileObserved(batch.x, batch.y)) {
                this.engine.emitEvent(batch);
            }
        }
        this._batches.clear();
    }

    /**
     * @private
     * @param {number} laneEid
     * @returns {void}
     */
    _emitLaneCreated(laneEid) {
        const laneRow = this._getLaneRowByLaneRef(laneEid);
        const head = this.lanes.store.headCell[laneRow];
        const position = this.engine.Position;
        if (!this.engine.isTileObserved(position.x[head], position.y[head])) {
            return;
        }
        this.engine.emitEvent(new LaneCreatedEvent(
            position.x[head],
            position.y[head],
            laneEid,
            this.getCellEidsByLaneRef(laneEid).map(cell => this.engine.placed.getObjectRefByEid(cell)),
            this._getParentEdgesByLaneRef(laneEid),
            this.lanes.store.outputPort[laneRow],
        ));
    }

    /**
     * @private
     * @param {number} laneEid
     * @returns {void}
     */
    _addLaneItemSyncs(laneEid) {
        const laneRow = this._getLaneRowByLaneRef(laneEid);
        const batch = this._getBatchByLaneRow(laneRow);
        for (const item of this.getItemsByLaneRef(laneEid)) {
            batch.addSync(laneEid, item.itemRef, item.gap, item.itemTypeId);
        }
    }

    /**
     * The chunk's lanes and the items on them, for a subscribing session.
     * @param {number} chunkKey
     * @returns {AbstractEvent[]}
     */
    chunkSync(chunkKey) {
        const lanes = this._lanesByChunk.get(chunkKey);
        if (lanes === undefined) {
            return [];
        }
        const position = this.engine.Position;
        let geometry = null;
        let items = null;
        for (const laneEid of lanes) {
            const laneRow = this._getLaneRowByLaneRef(laneEid);
            const head = this.lanes.store.headCell[laneRow];
            if (geometry === null) {
                geometry = new LaneSyncBatchEvent(position.x[head], position.y[head]);
                items = new LaneItemBatchEvent(position.x[head], position.y[head]);
            }
            geometry.add(
                laneEid,
                this.getCellEidsByLaneRef(laneEid).map(cell => this.engine.placed.getObjectRefByEid(cell)),
                this._getParentEdgesByLaneRef(laneEid),
                this.lanes.store.outputPort[laneRow],
            );
            for (const item of this.getItemsByLaneRef(laneEid)) {
                items.addSync(laneEid, item.itemRef, item.gap, item.itemTypeId);
            }
        }
        if (geometry === null) {
            return [];
        }
        if (items.isEmpty) {
            return [geometry];
        }
        return [geometry, items];
    }

    /**
     * Derives lanes from restored cells, then puts items on their slots.
     * Unknown items are replaced with gaps.
     * @returns {void}
     */
    rebuild() {
        this._lanesByChunk = new Map();
        this._batches.clear();
        const cells = Array.from(this.cells.getLiveEids());
        const itemSlotsByCellEid = new Map();
        for (const laneEid of this.getLaneRefs()) {
            this._popItemsIntoCellSlots(laneEid, itemSlotsByCellEid);
            this._destroyLane(laneEid);
        }
        this._batches.clear();
        this._destroyUnknownItems(itemSlotsByCellEid);
        const built = [];
        for (const eid of cells.sort((a, b) => a - b)) {
            if (this.getLaneRefByCellEid(eid) === NO_LANE) {
                built.push(this._buildLane(eid));
            }
        }
        for (const laneEid of built) {
            this._pushItemsFromCellSlots(laneEid, itemSlotsByCellEid);
        }
        for (const items of itemSlotsByCellEid.values()) {
            this._destroyCellSlotItems(items);
        }
        this._batches.clear();
    }

    /**
     * @private
     * @param {number[]|undefined} items
     * @returns {void}
     */
    _destroyCellSlotItems(items) {
        if (items === undefined) {
            return;
        }
        for (const eid of items) {
            if (eid !== NO_EID) {
                this.items.destroy(eid);
            }
        }
    }

    /**
     * @private
     * @param {Map<number, number[]>} itemSlotsByCellEid
     * @returns {void}
     */
    _destroyUnknownItems(itemSlotsByCellEid) {
        if (this.engine.modRegistry === null) {
            return;
        }
        const items = this.engine.modRegistry.items;
        for (const cellSlots of itemSlotsByCellEid.values()) {
            for (let slot = 0; slot < cellSlots.length; slot += 1) {
                const eid = cellSlots[slot];
                if (eid !== NO_EID && items.findItemTypeByTypeId(this.items.store.itemTypeId[this.items.getRowByEid(eid)]) === undefined) {
                    cellSlots[slot] = NO_EID;
                    this.items.destroy(eid);
                }
            }
        }
    }
}
