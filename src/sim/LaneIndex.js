import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {chunkKeyAt} from "@/common/util.js";
import {portAt} from "@/common/portGeometry.js";
import {
    LaneGeometryEvent,
    LaneGeometryBatchEvent,
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
// This should be called getLaneLevelLayer()
export function laneLevelLayer(level, direction) {
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
// getLaneCallLayer()
export function laneCellLayer(inLevel, outLevel, direction) {
    if (inLevel !== outLevel || inLevel === LANE_LEVEL_SURFACE) {
        return LAYER_SURFACE;
    }
    return laneLevelLayer(inLevel, direction);
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
// Should be something like "shouldConnectPorts()"
function levelsMeet(outLevel, outDirection, inLevel, inDirection) {
    if (outLevel !== inLevel) {
        return false;
    }
    return laneLevelLayer(outLevel, outDirection) === laneLevelLayer(inLevel, inDirection);
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
    // should be getLaneByEid()
    laneOf(eid) {
        if (eid === NO_EID) {
            return NO_LANE;
        }
        const cellRow = this.cells.row(eid);
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
    // getLaneAt()
    laneAt(tileX, tileY, layer) {
        return this.laneOf(this.engine.placed.eidAt(tileX, tileY, layer));
    }

    /**
     * @returns {number[]} every live lane id
     */
    // getEids()
    ids() {
        return Array.from(this.lanes.entities());
    }

    /**
     * @param {number} laneRef
     * @returns {number[]} cell eids, head first
     */
    // getCellsByRef()
    cellsOf(laneRef) {
        const cells = [];
        let eid = this.lanes.store.headCell[this._laneRow(laneRef)];
        while (eid !== NO_EID) {
            cells.push(eid);
            eid = this.cells.store.childCell[this.cells.row(eid)];
        }
        return cells;
    }

    /**
     * @param {number} laneRef
     * @returns {number} slots
     */
    // getLenghtByRef()
    lengthOf(laneRef) {
        return this.lanes.store.slotCount[this._laneRow(laneRef)];
    }

    /**
     * @param {number} laneRef
     * @returns {number} port eid
     */
    // getInputPortByEid()
    inPortOf(laneRef) {
        return this.lanes.store.inPort[this._laneRow(laneRef)];
    }

    /**
     * @param {number} laneRef
     * @returns {number} port eid
     */
    outPortOf(laneRef) {
        return this.lanes.store.outPort[this._laneRow(laneRef)];
    }

    /**
     * @param {number} laneRef
     * @returns {{itemRef: number, itemTypeId: number, gap: number}[]} output-edge first
     */
    itemsOf(laneRef) {
        const store = this.items.store;
        return this.items.getFileByFirstItemEid(this.lanes.store.firstItem[this._laneRow(laneRef)]).map(itemEid => {
            const itemRow = this.items.row(itemEid);
            return {itemRef: store.itemRef[itemRow], itemTypeId: store.itemTypeId[itemRow], gap: store.gap[itemRow]};
        });
    }

    /**
     * The edge flow reaches a cell over, in the cell's own frame: UP is its straight back edge.
     * @param {number} eid - a lane cell
     * @returns {Direction}
     */
    parentEdgeOf(eid) {
        const cellRow = this.cells.row(eid);
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
    _parentEdgesOf(laneRef) {
        return this.cellsOf(laneRef).map(cell => this.cells.store.parentEdge[this.cells.row(cell)]);
    }

    /**
     * @param {number} laneRef
     * @returns {number}
     */
    itemCountOf(laneRef) {
        return this.lanes.store.itemCount[this._laneRow(laneRef)];
    }

    /**
     * @private
     * @param {number} laneRef
     * @returns {number} its column laneRow
     */
    _laneRow(laneRef) {
        const laneRow = this.lanes.row(laneRef);
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
    // _getBehavior
    _behavior(eid) {
        return this.engine.placed.behaviorFor(this.engine.placed.objectTypeIdOf(eid));
    }

    /**
     * The shared edge past a cell's output side.
     * @private
     * @param {number} eid
     * @returns {number} port eid
     */
    _outPortOfCell(eid) {
        const position = this.engine.Position;
        const direction = position.direction[eid];
        return this.engine.ports.at(
            position.x[eid] + Direction.dx(direction),
            position.y[eid] + Direction.dy(direction),
            direction,
        );
    }

    /**
     * The shared edge behind a cell, which is its lane's in-port when it heads one.
     * @private
     * @param {number} eid
     * @returns {number} port eid
     */
    _inPortOfCell(eid) {
        const position = this.engine.Position;
        return this.engine.ports.at(position.x[eid], position.y[eid], position.direction[eid]);
    }

    /**
     // This sentence makes no sense. Doesn,t even seem related to the method name
     * The cell `eid`'s flow enters, NO_EID when nothing takes it.
     * @private
     * @param {number} eid
     * @returns {number}
     */
    // _getChildByEid()
    _childOf(eid) {
        const position = this.engine.Position;
        const direction = position.direction[eid];
        const outLevel = this._behavior(eid).outLevel;
        for (const candidate of this.engine.ports.consumersOf(this._outPortOfCell(eid))) {
            if (this.cells.row(candidate) < 0) {
                continue;
            }
            if (levelsMeet(outLevel, direction, this._behavior(candidate).inLevel, position.direction[candidate])) {
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
    _outLevelOf(eid) {
        const behavior = this._behavior(eid);
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
    _parentCandidates(eid) {
        const engine = this.engine;
        const position = engine.Position;
        const direction = position.direction[eid];
        const inLevel = this._behavior(eid).inLevel;
        const type = engine.placed.typeFor(engine.placed.objectTypeIdOf(eid));
        const eids = [];
        const edges = [];
        for (const definition of type.activePorts("inputPorts")) {
            const edge = portAt(definition, position.x[eid], position.y[eid], direction);
            for (const producer of engine.ports.producersOf(engine.ports.at(edge.x, edge.y, edge.direction))) {
                if (this._outLevelOf(producer) === inLevel) {
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
    _parentLinkOf(eid) {
        const position = this.engine.Position;
        const direction = position.direction[eid];
        const candidates = this._parentCandidates(eid);
        if (candidates.eids.length === 0) {
            return {edge: Direction.UP, portEid: this._inPortOfCell(eid), parent: NO_EID};
        }
        // A lane cell outranks any other object, so a machine beside a head never cuts the line behind it.
        let contenders = candidates.eids.filter(candidate => this.cells.row(candidate) >= 0);
        if (contenders.length === 0) {
            contenders = candidates.eids;
        }
        const winner = this._behavior(eid).chooseParent(this.engine, contenders);
        const index = candidates.eids.indexOf(winner);
        const edge = candidates.edges[index];
        let parent = NO_EID;
        if (this.cells.row(winner) >= 0
            && levelsMeet(this._outLevelOf(winner), position.direction[winner], this._behavior(eid).inLevel, direction)) {
            parent = winner;
        }
        return {
            edge: Direction.rotate(edge.direction, 4 - direction),
            portEid: this.engine.ports.at(edge.x, edge.y, edge.direction),
            parent,
        };
    }

    /**
     * The lane cells that feed `eid`, whose own lanes a change at `eid` can move.
     * @private
     * @param {number} eid
     * @returns {number[]}
     */
    _parentCellsOf(eid) {
        return this._parentCandidates(eid).eids.filter(candidate => this.cells.row(candidate) >= 0);
    }

    /**
     * The one parent that continues its lane into `eid`, NO_EID when it has none.
     * @private
     * @param {number} eid
     * @returns {number}
     */
    _parentOf(eid) {
        return this._parentLinkOf(eid).parent;
    }

    // ---- edits ----

    /**
     * Adopts a freshly placed cell and rebuilds the lanes its links change.
     * @param {number} eid
     * @returns {void}
     */
    addCell(eid) {
        this.cells.attach(eid);
        const affected = this._affectedCells(this._dirtyAround(eid));
        affected.add(eid);
        this._rebuildCells(affected, NO_EID);
    }

    /**
     * Re-derives the lanes an object's output edges feed, so a machine placed or taken away beside a
     * lane head moves that head's parent edge and in-port with it. Lane cells come through
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
        if (this.cells.row(eid) >= 0) {
            return;
        }
        const engine = this.engine;
        const position = engine.Position;
        const type = engine.placed.typeFor(engine.placed.objectTypeIdOf(eid));
        const stale = new Set();
        for (const definition of type.activePorts("outputPorts")) {
            const edge = portAt(definition, position.x[eid], position.y[eid], position.direction[eid]);
            for (const cell of engine.ports.consumersOf(engine.ports.at(edge.x, edge.y, edge.direction))) {
                const cellRow = this.cells.row(cell);
                if (cellRow >= 0 && this._parentLinkOf(cell).edge !== this.cells.store.parentEdge[cellRow]) {
                    stale.add(cell);
                }
            }
        }
        if (stale.size === 0) {
            return;
        }
        this._rebuildCells(this._affectedCells(stale), NO_EID);
    }

    /**
     * Drops a cell being deleted and rebuilds what it was part of.
     * @param {number} eid
     * @returns {void}
     */
    removeCell(eid) {
        const dirty = this._dirtyAround(eid);
        dirty.delete(eid);
        const affected = this._affectedCells(dirty);
        const laneEid = this.laneOf(eid);
        if (laneEid !== NO_LANE) {
            for (const cell of this.cellsOf(laneEid)) {
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
        for (const parent of this._parentCellsOf(eid)) {
            dirty.add(parent);
        }
        const child = this._childOf(eid);
        if (child !== NO_EID) {
            dirty.add(child);
            for (const parent of this._parentCellsOf(child)) {
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
    _affectedCells(dirty) {
        const affected = new Set();
        for (const eid of dirty) {
            const laneEid = this.laneOf(eid);
            if (laneEid === NO_LANE) {
                affected.add(eid);
                continue;
            }
            for (const cell of this.cellsOf(laneEid)) {
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
        const heldByCell = new Map();
        const lanes = new Set();
        for (const eid of cells) {
            const laneEid = this.laneOf(eid);
            if (laneEid !== NO_LANE) {
                lanes.add(laneEid);
            }
        }
        if (dropped !== NO_EID) {
            const laneEid = this.laneOf(dropped);
            if (laneEid !== NO_LANE) {
                lanes.add(laneEid);
            }
        }
        for (const laneEid of lanes) {
            this._captureItems(laneEid, heldByCell);
            this._destroyLane(laneEid);
        }
        // The resets go out now: a rebuilt lane may take a destroyed one's eid, and the client
        // forgets a lane on its reset.
        this._flushBatches();
        this._destroyHeld(heldByCell.get(dropped));
        heldByCell.delete(dropped);

        const ordered = Array.from(cells).sort((a, b) => a - b);
        const built = [];
        for (const eid of ordered) {
            if (this.laneOf(eid) !== NO_LANE) {
                continue;
            }
            built.push(this._buildLaneFrom(eid));
        }
        for (const laneEid of built) {
            this._placeItems(laneEid, heldByCell);
        }
        for (const items of heldByCell.values()) {
            this._destroyHeld(items);
        }
        for (const laneEid of built) {
            this._emitGeometry(laneEid);
            this._emitSync(laneEid);
        }
        this._flushBatches();
        // The port items the rebuild moved go out with its rows, not a render pass later.
        this.engine.render.emit();
    }

    /**
     * Builds the maximal chain of links through `eid`, inside its chunk.
     * @private
     * @param {number} eid
     * @returns {number} the lane id
     */
    _buildLaneFrom(eid) {
        const chunkKey = this._chunkOf(eid);
        const seen = new Set([eid]);
        let start = eid;
        for (;;) {
            const parent = this._parentOf(start);
            if (parent === NO_EID || seen.has(parent) || this._chunkOf(parent) !== chunkKey) {
                break;
            }
            if (this.laneOf(parent) !== NO_LANE) {
                break;
            }
            seen.add(parent);
            start = parent;
        }
        const cells = [];
        let cell = start;
        while (cell !== NO_EID) {
            cells.push(cell);
            const child = this._childOf(cell);
            if (child === NO_EID || this._chunkOf(child) !== chunkKey) {
                break;
            }
            if (this._parentOf(child) !== cell || cells.includes(child)) {
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
    _chunkOf(eid) {
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
        const laneRow = this.lanes.row(laneEid);
        const lanes = this.lanes.store;
        const tail = cells[cells.length - 1];
        let slots = 0;
        for (let i = 0; i < cells.length; i += 1) {
            const cellRow = this.cells.row(cells[i]);
            this.cells.store.lane[cellRow] = laneEid;
            const next = i + 1 < cells.length ? cells[i + 1] : NO_EID;
            this.cells.store.childCell[cellRow] = next;
            this.cells.store.parentEdge[cellRow] = this._parentLinkOf(cells[i]).edge;
            slots += this._behavior(cells[i]).slotsPerTile;
        }
        lanes.headCell[laneRow] = cells[0];
        lanes.outPort[laneRow] = this._outPortOfCell(tail);
        lanes.inPort[laneRow] = this._parentLinkOf(cells[0]).portEid;
        lanes.slotCount[laneRow] = slots - 1;
        lanes.itemCount[laneRow] = 0;
        lanes.headGap[laneRow] = slots - 1;
        lanes.firstItem[laneRow] = NO_EID;
        lanes.lastItem[laneRow] = NO_EID;
        lanes.nextItemRef[laneRow] = 1;
        const chunkKey = this._chunkOf(cells[0]);
        let chunkLanes = this._lanesByChunk.get(chunkKey);
        if (chunkLanes === undefined) {
            chunkLanes = new Set();
            this._lanesByChunk.set(chunkKey, chunkLanes);
        }
        chunkLanes.add(laneEid);
        // The out-port is the tail cell's last slot, so its in-port item item draws on the tail's tile
        // and routes to the lane's own chunk.
        const position = engine.Position;
        engine.render.registerPort(lanes.outPort[laneRow], position.x[tail], position.y[tail]);
        return laneEid;
    }

    /**
     * @private
     * @param {number} laneEid
     * @returns {void}
     */
    _destroyLane(laneEid) {
        const laneRow = this._laneRow(laneEid);
        const lanes = this.lanes.store;
        for (const cell of this.cellsOf(laneEid)) {
            const cellRow = this.cells.row(cell);
            this.cells.store.lane[cellRow] = NO_EID;
            this.cells.store.childCell[cellRow] = NO_EID;
        }
        this.engine.render.unregisterPort(lanes.outPort[laneRow]);
        const chunkKey = this._chunkOf(lanes.headCell[laneRow]);
        const chunkLanes = this._lanesByChunk.get(chunkKey);
        if (chunkLanes !== undefined) {
            chunkLanes.delete(laneEid);
            if (chunkLanes.size === 0) {
                this._lanesByChunk.delete(chunkKey);
            }
        }
        this._batchFor(chunkKey, lanes.headCell[laneRow]).addReset(laneEid);
        this.engine.components.destroyEntity(laneEid);
    }

    /**
     * Records where each of a lane's items stands, as the cell and the slot within it.
     * @private
     * @param {number} laneEid
     * @param {Map<number, number[]>} heldByCell
     * @returns {void}
     */
    _captureItems(laneEid, heldByCell) {
        const laneRow = this._laneRow(laneEid);
        const cells = this.cellsOf(laneEid);
        const slots = cells.map(cell => this._behavior(cell).slotsPerTile);
        let total = 0;
        for (const count of slots) {
            total += count;
        }
        const store = this.items.store;
        let slotFromOutput = 0;
        for (const itemEid of this.items.getFileByFirstItemEid(this.lanes.store.firstItem[laneRow])) {
            const itemRow = this.items.row(itemEid);
            slotFromOutput += store.gap[itemRow];
            const slotFromInput = total - 2 - slotFromOutput;
            this._hold(heldByCell, cells, slots, slotFromInput, itemEid);
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
     * @param {Map<number, number[]>} heldByCell
     * @param {number[]} cells
     * @param {number[]} slots
     * @param {number} slotFromInput - the slot counted from the lane's input edge
     * @param {number} itemEid
     * @returns {void}
     */
    _hold(heldByCell, cells, slots, slotFromInput, itemEid) {
        let offset = slotFromInput;
        for (let i = 0; i < cells.length; i += 1) {
            if (offset < slots[i]) {
                let cellSlots = heldByCell.get(cells[i]);
                if (cellSlots === undefined) {
                    cellSlots = new Array(slots[i]).fill(NO_EID);
                    heldByCell.set(cells[i], cellSlots);
                }
                cellSlots[offset] = itemEid;
                return;
            }
            offset -= slots[i];
        }
        throw new Error(`Lane item at slot ${slotFromInput} stands on no cell`);
    }

    /**
     * Puts the held items back on a rebuilt lane, and takes in whatever rests in an edge that is
     * now interior to it.
     * @private
     * @param {number} laneEid
     * @param {Map<number, number[]>} heldByCell
     * @returns {void}
     */
    _placeItems(laneEid, heldByCell) {
        const cells = this.cellsOf(laneEid);
        const slots = cells.map(cell => this._behavior(cell).slotsPerTile);
        for (let i = 1; i < cells.length; i += 1) {
            this._absorbEdge(heldByCell, cells, slots, i);
        }
        const laneRow = this._laneRow(laneEid);
        const lanes = this.lanes.store;
        let total = 0;
        for (const count of slots) {
            total += count;
        }
        let slotFromInput = total - 1;
        let previous = -1;
        for (let i = cells.length - 1; i >= 0; i -= 1) {
            const items = heldByCell.get(cells[i]);
            for (let slot = slots[i] - 1; slot >= 0; slot -= 1) {
                const itemEid = items === undefined ? NO_EID : items[slot];
                const slotFromOutput = total - 2 - slotFromInput;
                slotFromInput -= 1;
                if (itemEid === NO_EID) {
                    continue;
                }
                items[slot] = NO_EID;
                if (slotFromOutput < 0) {
                    // The tail cell's last slot is the out-port itself.
                    this.engine.ports.setItem(lanes.outPort[laneRow], this.items.store.itemTypeId[this.items.row(itemEid)]);
                    this.items.destroy(itemEid);
                    continue;
                }
                this._appendItem(laneEid, itemEid, slotFromOutput - previous - 1);
                previous = slotFromOutput;
            }
        }
        lanes.headGap[laneRow] = total - 1 - this._usedSlots(laneEid);
    }

    /**
     * Takes the item resting in the edge before cell `index`, which the rebuild made interior. That
     * edge is where the upstream cell hands flow over, not cell `index`'s straight back edge: a bent
     * cell takes flow across a flank, and its back edge is a side input this lane never crosses.
     * @private
     * @param {Map<number, number[]>} heldByCell
     * @param {number[]} cells
     * @param {number[]} slots
     * @param {number} index
     * @returns {void}
     */
    _absorbEdge(heldByCell, cells, slots, index) {
        const portEid = this._outPortOfCell(cells[index - 1]);
        const portItem = this.engine.ports.item(portEid);
        if (portItem === EMPTY || this.engine.isFluid(portItem)) {
            return;
        }
        const slot = slots[index - 1] - 1;
        let cellSlots = heldByCell.get(cells[index - 1]);
        if (cellSlots === undefined) {
            cellSlots = new Array(slots[index - 1]).fill(NO_EID);
            heldByCell.set(cells[index - 1], cellSlots);
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
    _usedSlots(laneEid) {
        const laneRow = this._laneRow(laneEid);
        const store = this.items.store;
        let used = 0;
        for (const itemEid of this.items.getFileByFirstItemEid(this.lanes.store.firstItem[laneRow])) {
            used += store.gap[this.items.row(itemEid)] + 1;
        }
        return used;
    }

    /**
     * Appends an item at the input end of a lane's file.
     * @private
     * @param {number} laneEid
     * @param {number} itemEid
     * @param {number} gap
     * @returns {void}
     */
    _appendItem(laneEid, itemEid, gap) {
        const laneRow = this._laneRow(laneEid);
        const lanes = this.lanes.store;
        const itemRow = this.items.row(itemEid);
        this.items.store.lane[itemRow] = laneEid;
        this.items.store.nextItem[itemRow] = NO_EID;
        this.items.store.gap[itemRow] = gap;
        this.items.store.itemRef[itemRow] = lanes.nextItemRef[laneRow];
        lanes.nextItemRef[laneRow] += 1;
        if (lanes.firstItem[laneRow] === NO_EID) {
            lanes.firstItem[laneRow] = itemEid;
        } else {
            this.items.store.nextItem[this.items.row(lanes.lastItem[laneRow])] = itemEid;
        }
        lanes.lastItem[laneRow] = itemEid;
        lanes.itemCount[laneRow] += 1;
    }

    // ---- the step ----

    /**
     * The pop past the tail and the ingest at the head.
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
            const inPort = lanes.inPort[laneRow];
            const inPortItem = engine.ports.item(inPort);
            // A lane has one input; a resting fluid is refused, so its producer backs up.
            const inPortTakeable = inPortItem !== EMPTY && !engine.isFluid(inPortItem);
            const leadItem = lanes.firstItem[laneRow];
            if (leadItem !== NO_EID && items.gap[this.items.row(leadItem)] === 0 && this._canPop(laneRow)) {
                this._submitPop(laneRow, inPortItem, items.itemTypeId[this.items.row(leadItem)]);
            }
            if (inPortTakeable && lanes.itemCount[laneRow] < lanes.slotCount[laneRow]) {
                this._drainItem[laneRow] = inPortItem;
                this._drainIntent[laneRow] = engine.transfers.submitDrain(inPort);
            }
        }
    }

    /**
     * pop leadItem in output port, shift input port's item into lane
     * @private
     * @param {number} laneRow
     * @param {number} inputPortItem // Should this be inputPortItemTypeId?
     * @param {number} leadTypeId
     * @returns {void}
     */
    _submitPop(laneRow, inPortItem, leadTypeId) {
        const lanes = this.lanes.store;
        const transfers = this.engine.transfers;
        const outPort = lanes.outPort[laneRow];
        const outPortEmpty = this.engine.ports.item(outPort) === EMPTY;
        if (this.engine.isFluid(inPortItem)) {
            this._popSourceItem[laneRow] = EMPTY;
            this._popIntent[laneRow] = transfers.submitCreate(outPort, leadTypeId, outPortEmpty);
            return;
        }
        this._popSourceItem[laneRow] = inPortItem;
        this._popIntent[laneRow] = transfers.submitTransfer(lanes.inPort[laneRow], outPort, outPortEmpty, EMPTY, leadTypeId);
    }

    /**
     * Whether the lead may leave this tick: never into a fluid port. Whether the out-port empties,
     * by being empty or by whatever is past it taking its item, is the resolver's question.
     * @private
     * @param {number} laneRow
     * @returns {boolean}
     */
    _canPop(laneRow) {
        return !this.engine.ports.isFluidClaimed(this.lanes.store.outPort[laneRow]);
    }

    /**
     * Advances every file by what its intents won, and takes in what its drain took.
     * @returns {void}
     */
    postResolve() {
        const transfers = this.engine.transfers;
        for (let laneRow = 0; laneRow < this.lanes.count; laneRow += 1) {
            const laneEid = this.lanes.eids[laneRow];
            const popped = this._popIntent[laneRow] !== NO_INTENT && transfers.wasResolved(this._popIntent[laneRow]);
            let takenItem = EMPTY;
            if (popped) {
                this._popLead(laneEid, laneRow);
                takenItem = this._popSourceItem[laneRow];
            } else {
                this._shiftItems(laneEid, laneRow);
            }
            // The item enters once, whichever intent emptied the port.
            if (takenItem === EMPTY && this._drainIntent[laneRow] !== NO_INTENT && transfers.wasResolved(this._drainIntent[laneRow])) {
                takenItem = this._drainItem[laneRow];
            }
            if (takenItem !== EMPTY) {
                this._shiftItemIntoInputPort(laneEid, laneRow, takenItem);
            }
        }
        this._flushBatches();
    }

    /**
     * Drops the lead item, which the pop moved into the out-port; the rest of the file advances with
     * it, their stored gaps already correct.
     * @private
     * @param {number} laneEid
     * @param {number} laneRow
     * @returns {void}
     */
    _popLead(laneEid, laneRow) {
        const lanes = this.lanes.store;
        const leadItem = lanes.firstItem[laneRow];
        const itemRow = this.items.row(leadItem);
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
            const itemRow = this.items.row(itemEid);
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
     * Puts the item an intent took from the ingest port onto the input-edge slot.
     * @private
     * @param {number} laneEid
     * @param {number} laneRow
     * @param {number} itemTypeId
     * @returns {void}
     */
    // ingest? put? pick a terminology.
    _shiftItemIntoInputPort(laneEid, laneRow, itemTypeId) {
        const lanes = this.lanes.store;
        const itemEid = this.items.create(itemTypeId);
        this._appendItem(laneEid, itemEid, lanes.headGap[laneRow] - 1);
        lanes.headGap[laneRow] = 0;
        const itemRow = this.items.row(itemEid);
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

    // What does "feed" even mean? That's not established terminology. Be precise
    // The session terminilogy uses "subscription" to a list of chunks, 
    // to pub-sub language. 'Subscription feed' would make more sense if that's what you mean
    // but more importantly we don't need any section headers like that. and that's a code smell.
    // the sections should be self evident

    /**
     * @private
     * @param {number} laneRow - a lane's column laneRow
     * @returns {LaneItemBatchEvent}
     */
    _getBatchByLaneRow(laneRow) {
        const head = this.lanes.store.headCell[laneRow];
        return this._batchFor(this._chunkOf(head), head);
    }

    /**
     * @private
     * @param {number} chunkKey
     * @param {number} eid - a cell in that chunk, positioning the batch
     * @returns {LaneItemBatchEvent}
     */
    _batchFor(chunkKey, eid) {
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
            if (!batch.isEmpty && this.engine.observesTile(batch.x, batch.y)) {
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
    // emit geometry? That's not an action, that's not precice.
    // Should be something like _emitGeometryChange/Update/Diff. Propose a terminology and stick to it
    _emitGeometry(laneEid) {
        const laneRow = this._laneRow(laneEid);
        const head = this.lanes.store.headCell[laneRow];
        const position = this.engine.Position;
        if (!this.engine.observesTile(position.x[head], position.y[head])) {
            return;
        }
        this.engine.emitEvent(new LaneGeometryEvent(
            position.x[head],
            position.y[head],
            laneEid,
            this.cellsOf(laneEid).map(cell => this.engine.placed.objectRefOf(cell)),
            this._parentEdgesOf(laneEid),
            this.lanes.store.outPort[laneRow],
        ));
    }

    /**
     * @private
     * @param {number} laneEid
     * @returns {void}
     */
    _emitSync(laneEid) {
        const laneRow = this._laneRow(laneEid);
        const batch = this._getBatchByLaneRow(laneRow);
        for (const item of this.itemsOf(laneEid)) {
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
            const laneRow = this._laneRow(laneEid);
            const head = this.lanes.store.headCell[laneRow];
            if (geometry === null) {
                geometry = new LaneGeometryBatchEvent(position.x[head], position.y[head]);
                items = new LaneItemBatchEvent(position.x[head], position.y[head]);
            }
            geometry.add(
                laneEid,
                this.cellsOf(laneEid).map(cell => this.engine.placed.objectRefOf(cell)),
                this._parentEdgesOf(laneEid),
                this.lanes.store.outPort[laneRow],
            );
            for (const item of this.itemsOf(laneEid)) {
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
        const cells = Array.from(this.cells.entities());
        const heldByCell = new Map();
        for (const laneEid of this.ids()) {
            this._captureItems(laneEid, heldByCell);
            this._destroyLane(laneEid);
        }
        this._batches.clear();
        this._dropUnknownItems(heldByCell);
        const built = [];
        for (const eid of cells.sort((a, b) => a - b)) {
            if (this.laneOf(eid) === NO_LANE) {
                built.push(this._buildLaneFrom(eid));
            }
        }
        for (const laneEid of built) {
            this._placeItems(laneEid, heldByCell);
        }
        for (const items of heldByCell.values()) {
            this._destroyHeld(items);
        }
        this._batches.clear();
    }

    /**
     * @private
     * @param {number[]|undefined} items
     * @returns {void}
     */
    // This function name makes no sense. It doesn't tell me anything about what it's doing.
    _destroyHeld(items) {
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
     * @param {Map<number, number[]>} heldByCell
     * @returns {void}
     */
    // Drop? HOw is that different from "destroy"? Why not say destroyUnknownItems???
    _dropUnknownItems(heldByCell) {
        if (this.engine.modRegistry === null) {
            return;
        }
        const items = this.engine.modRegistry.items;
        for (const cellSlots of heldByCell.values()) {
            for (let slot = 0; slot < cellSlots.length; slot += 1) {
                const eid = cellSlots[slot];
                if (eid !== NO_EID && items.get(this.items.store.itemTypeId[this.items.row(eid)]) === undefined) {
                    cellSlots[slot] = NO_EID;
                    this.items.destroy(eid);
                }
            }
        }
    }
}
