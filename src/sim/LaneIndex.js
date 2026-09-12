import {
    Axis,
    Direction,
    LAYER_SURFACE,
    LAYER_LANE_BURIED_HORIZONTAL,
    LAYER_LANE_BURIED_VERTICAL,
    LAYER_LANE_ELEVATED_1,
    LAYER_LANE_ELEVATED_2,
} from "@/common/constants.js";
import {chunkKeyAt} from "@/common/util.js";
import {portAt} from "@/common/portGeometry.js";
import {
    LaneCreatedEvent,
    LaneSyncBatchEvent,
    LaneItemBatchEvent,
} from "@/common/LaneEvents.js";
import {AbstractSystem} from "@/sim/AbstractSystem.js";
import {AbstractComponent, FieldDefinition, EMPTY, NO_EID} from "@/sim/AbstractComponent.js";

/**
 * One cell of a lane: the lane it belongs to, the cell flow continues into, and the edge flow
 * reaches it over.
 */
class LaneCellComponent extends AbstractComponent {

    constructor() {
        super("LaneCell", [
            new FieldDefinition("lane", "eid", NO_EID),
            new FieldDefinition("childCell", "eid", NO_EID),
            // In the cell's own frame: UP is its straight back edge.
            new FieldDefinition("parentEdge", "i32", Direction.UP),
        ], {isSparse: true});
    }

    /**
     * @param {number} eid - a lane cell
     * @returns {number} its lane, NO_LANE when it is in none
     */
    getLaneRefByEid(eid) {
        if (eid === NO_EID) {
            return NO_LANE;
        }
        const row = this.getRowByEid(eid);
        if (row < 0) {
            return NO_LANE;
        }
        const laneEid = this.store.lane[row];
        if (laneEid === NO_EID) {
            return NO_LANE;
        }
        return laneEid;
    }

    /**
     * The edge flow reaches a cell over, in the cell's own frame: UP is its straight back edge.
     * @param {number} eid - a lane cell
     * @returns {Direction}
     */
    getParentEdgeByEid(eid) {
        const row = this.getRowByEid(eid);
        if (row < 0) {
            throw new Error(`Entity ${eid} is no lane cell`);
        }
        return this.store.parentEdge[row];
    }
}

/**
 * The items riding the lanes: each lane holds its items in a singly linked file ordered
 * output-edge first. An item carries the number of empty slots ahead of it, so one decrement
 * advances it and everything behind it, and popping the lead leaves the next item's gap already
 * correct.
 */
class LaneItemComponent extends AbstractComponent {

    constructor() {
        super("LaneItem", [
            new FieldDefinition("lane", "eid", NO_EID),
            new FieldDefinition("nextItem", "eid", NO_EID),
            new FieldDefinition("itemTypeId", "item", EMPTY),
            new FieldDefinition("gap"),
            new FieldDefinition("itemRef"),
        ], {isSparse: true});
    }

    /**
     * Creates a detached item.
     * @param {number} itemTypeId
     * @returns {number} the item eid
     */
    create(itemTypeId) {
        const eid = super.create();
        this.store.itemTypeId[this.getRowByEid(eid)] = itemTypeId;
        return eid;
    }

    /**
     * Every item of a file, output-edge first.
     * @param {number} firstItemEid - the lane's lead item, NO_EID when it holds none
     * @returns {number[]} item eids
     */
    getFileByFirstItemEid(firstItemEid) {
        const itemEids = [];
        let itemEid = firstItemEid;
        while (itemEid !== NO_EID) {
            itemEids.push(itemEid);
            itemEid = this.store.nextItem[this.getRowByEid(itemEid)];
        }
        return itemEids;
    }

    /**
     * Destroys every item of a cell's slots, skipping the empty ones.
     * @param {number[]} itemEids NO_EID for an empty slot
     * @returns {void}
     */
    destroyAll(itemEids) {
        for (const itemEid of itemEids) {
            if (itemEid !== NO_EID) {
                this.destroy(itemEid);
            }
        }
    }
}

// The level a lane cell takes flow from or gives it to: 0 is the surface, negative is buried,
// positive is elevated.
export const LANE_LEVEL_BURIED = -1;
export const LANE_LEVEL_SURFACE = 0;
export const LANE_LEVEL_ELEVATED_1 = 1;
export const LANE_LEVEL_ELEVATED_2 = 2;
/** @typedef {number} LaneLevel */

// Lookup answer for a cell, tile or port that belongs to no lane.
export const NO_LANE = -1;

// Scratch value for a lane that submitted no intent this tick.
const NO_INTENT = -1;

/**
 * A lane level and the layers its cells occupy: an axis-split level takes a layer per axis, so two
 * lanes cross on one tile and neither bends; an unsplit level takes one layer, so lanes there bend
 * freely but two of them cannot share a tile.
 */
class LaneLevelEntry {

    /**
     * @param {LaneLevel} level
     * @param {string} horizontalLayer
     * @param {string} verticalLayer - the same layer for an unsplit level
     */
    constructor(level, horizontalLayer, verticalLayer) {
        this.level = level;
        this.horizontalLayer = horizontalLayer;
        this.verticalLayer = verticalLayer;
    }

    /**
     * @param {Direction} direction
     * @returns {string} the layer a cell running `direction` occupies
     */
    getLayerByDirection(direction) {
        if (Direction.axis(direction) === Axis.VERTICAL) {
            return this.verticalLayer;
        }
        return this.horizontalLayer;
    }
}

const LANE_LEVELS = [
    new LaneLevelEntry(LANE_LEVEL_BURIED, LAYER_LANE_BURIED_HORIZONTAL, LAYER_LANE_BURIED_VERTICAL),
    new LaneLevelEntry(LANE_LEVEL_SURFACE, LAYER_SURFACE, LAYER_SURFACE),
    new LaneLevelEntry(LANE_LEVEL_ELEVATED_1, LAYER_LANE_ELEVATED_1, LAYER_LANE_ELEVATED_1),
    new LaneLevelEntry(LANE_LEVEL_ELEVATED_2, LAYER_LANE_ELEVATED_2, LAYER_LANE_ELEVATED_2),
];

// The layers a lane stands on at and above the surface, highest level first: what a pointer on a
// tile means is the first of these holding something. Buried cells are derived from the mouths
// that spawned them, so they are not in it.
export const LANE_LAYERS_HIGHEST_FIRST = LANE_LEVELS
    .filter(entry => entry.level >= LANE_LEVEL_SURFACE)
    .sort((a, b) => b.level - a.level)
    .map(entry => entry.horizontalLayer);

/**
 * @param {LaneLevel} level
 * @returns {LaneLevelEntry}
 */
function getLaneLevelEntryByLevel(level) {
    const laneLevel = LANE_LEVELS.find(entry => entry.level === level);
    if (laneLevel === undefined) {
        throw new Error(`No lane level ${level}`);
    }
    return laneLevel;
}

/**
 * The occupancy layer of `level`, for a cell running `direction`.
 * @param {LaneLevel} level
 * @param {Direction} direction
 * @returns {string}
 */
export function getLaneLevelLayer(level, direction) {
    return getLaneLevelEntryByLevel(level).getLayerByDirection(direction);
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

/**
 * @typedef {Object} LaneItemRow
 * @property {number} itemRef
 * @property {number} itemTypeId
 * @property {number} gap
 */

/**
 * @typedef {Object} ParentCandidates
 * @property {number[]} eids
 * @property {Vec[]} edges
 */

/**
 * @typedef {Object} ParentLink
 * @property {Direction} edge
 * @property {number} portEid
 * @property {number} parent
 */

/**
 * A transport lane: the chain of cells from its head, the ports at its two ends, and the file of
 * items riding it.
 */
class LaneComponent extends AbstractComponent {

    constructor() {
        super("Lane", [
            new FieldDefinition("headCell", "eid", NO_EID),
            new FieldDefinition("inputPort", "eid", NO_EID),
            new FieldDefinition("outputPort", "eid", NO_EID),
            new FieldDefinition("slotCount"),
            new FieldDefinition("itemCount"),
            new FieldDefinition("headGap"),
            new FieldDefinition("firstItem", "eid", NO_EID),
            new FieldDefinition("lastItem", "eid", NO_EID),
            new FieldDefinition("nextItemRef", "i32", 1),
        ], {isSparse: true});
    }

    /**
     * Creates an empty lane with its head gap spanning every slot.
     * @param {number} headCellEid
     * @param {number} inputPortEid
     * @param {number} outputPortEid
     * @param {number} slotCount
     * @returns {number} the lane eid
     */
    create(headCellEid, inputPortEid, outputPortEid, slotCount) {
        const eid = super.create();
        const row = this.getRowByEid(eid);
        this.store.headCell[row] = headCellEid;
        this.store.inputPort[row] = inputPortEid;
        this.store.outputPort[row] = outputPortEid;
        this.store.slotCount[row] = slotCount;
        this.store.headGap[row] = slotCount;
        return eid;
    }

    /**
     * @param {number} laneRef
     * @returns {number} its column row
     */
    getRowByLaneRef(laneRef) {
        const row = this.getRowByEid(laneRef);
        if (row < 0) {
            throw new Error(`No lane ${laneRef}`);
        }
        return row;
    }

    /**
     * Empties a lane's file bookkeeping; the items themselves are the caller's to move or destroy.
     * @param {number} row
     * @returns {void}
     */
    resetFile(row) {
        this.store.firstItem[row] = NO_EID;
        this.store.lastItem[row] = NO_EID;
        this.store.itemCount[row] = 0;
    }
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

        for (const laneLevel of LANE_LEVELS) {
            engine.space.registerLayer(laneLevel.horizontalLayer);
            engine.space.registerLayer(laneLevel.verticalLayer);
        }

        /**
         * So the client feed and chunk sync skip the rest of the world.
         * @type {Map<number, Set<number>>}
         */
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
        return this.cells.getLaneRefByEid(eid);
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
        let eid = this.lanes.store.headCell[this.lanes.getRowByLaneRef(laneRef)];
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
        return this.lanes.store.slotCount[this.lanes.getRowByLaneRef(laneRef)];
    }

    /**
     * @param {number} laneRef
     * @returns {number} port eid
     */
    getInputPortEidByLaneRef(laneRef) {
        return this.lanes.store.inputPort[this.lanes.getRowByLaneRef(laneRef)];
    }

    /**
     * @param {number} laneRef
     * @returns {number} port eid
     */
    getOutputPortEidByLaneRef(laneRef) {
        return this.lanes.store.outputPort[this.lanes.getRowByLaneRef(laneRef)];
    }

    /**
     * @param {number} laneRef
     * @returns {LaneItemRow[]} output-edge first
     */
    getItemsByLaneRef(laneRef) {
        const store = this.items.store;
        return this.items.getFileByFirstItemEid(this.lanes.store.firstItem[this.lanes.getRowByLaneRef(laneRef)]).map(itemEid => {
            const itemRow = this.items.getRowByEid(itemEid);
            return {itemRef: store.itemRef[itemRow], itemTypeId: store.itemTypeId[itemRow], gap: store.gap[itemRow]};
        });
    }

    /**
     * @param {number} eid - a lane cell
     * @returns {Direction}
     */
    getParentEdgeByCellEid(eid) {
        return this.cells.getParentEdgeByEid(eid);
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
        return this.lanes.store.itemCount[this.lanes.getRowByLaneRef(laneRef)];
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
     * The cell the flow leaving `eid` enters, NO_EID when nothing takes it.
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
            if (shouldConnectLevels(outLevel, direction, this._getInLevelByEid(candidate), position.direction[candidate])) {
                return candidate;
            }
        }
        return NO_EID;
    }

    /**
     * Whether a cell of `type` placed at (tileX, tileY) facing `direction` joins a run: something at
     * one of its input edges hands flow on at the level it takes, or something across an output edge
     * takes what it gives.
     * @param {ObjectType} type
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {boolean}
     */
    isJoiningRunAt(type, tileX, tileY, direction) {
        return this._hasParentAt(type, tileX, tileY, direction)
            || this._hasChildAt(type, tileX, tileY, direction);
    }

    /**
     * @private
     * @param {ObjectType} type
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {boolean} whether an object at an input edge hands flow on at the cell's in-level
     */
    _hasParentAt(type, tileX, tileY, direction) {
        const engine = this.engine;
        for (const definition of type.getActivePortsByKind("inputPorts")) {
            const edge = portAt(definition, tileX, tileY, direction);
            const portEid = engine.ports.getPortEidAtOrNull(edge.x, edge.y, edge.direction);
            if (portEid === null) {
                continue;
            }
            for (const producer of engine.ports.getProducerEidsByPortEid(portEid)) {
                if (shouldConnectLevels(this._getOutLevelByEid(producer), engine.Position.direction[producer], type.behavior.inLevel, direction)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * @private
     * @param {ObjectType} type
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {boolean} whether an object across an output edge takes flow at the cell's out-level
     */
    _hasChildAt(type, tileX, tileY, direction) {
        const engine = this.engine;
        for (const definition of type.getActivePortsByKind("outputPorts")) {
            const edge = portAt(definition, tileX, tileY, direction);
            const portEid = engine.ports.getPortEidAtOrNull(edge.x, edge.y, edge.direction);
            if (portEid === null) {
                continue;
            }
            for (const consumer of engine.ports.getConsumerEidsByPortEid(portEid)) {
                if (shouldConnectLevels(type.behavior.outLevel, direction, this._getInLevelByEid(consumer), engine.Position.direction[consumer])) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * The level an object gives flow at; anything but a lane cell gives it on the surface.
     * @private
     * @param {number} eid
     * @returns {LaneLevel}
     */
    _getOutLevelByEid(eid) {
        const behavior = this._getBehaviorByCellEid(eid);
        if (behavior.outLevel === undefined) {
            return LANE_LEVEL_SURFACE;
        }
        return behavior.outLevel;
    }

    /**
     * The level an object takes flow at; anything but a lane cell takes it on the surface.
     * @private
     * @param {number} eid
     * @returns {LaneLevel}
     */
    _getInLevelByEid(eid) {
        const behavior = this._getBehaviorByCellEid(eid);
        if (behavior.inLevel === undefined) {
            return LANE_LEVEL_SURFACE;
        }
        return behavior.inLevel;
    }

    /**
     * Every adjacent object giving flow into one of `eid`'s declared input edges at its own level,
     * with the edge each of them hands it.
     * @private
     * @param {number} eid
     * @returns {ParentCandidates}
     */
    _getParentCandidatesByCellEid(eid) {
        const engine = this.engine;
        const position = engine.Position;
        const direction = position.direction[eid];
        const inLevel = this._getInLevelByEid(eid);
        const type = engine.placed.getObjectTypeByTypeId(engine.placed.getObjectTypeIdByEid(eid));
        const eids = [];
        const edges = [];
        for (const definition of type.getActivePortsByKind("inputPorts")) {
            const edge = portAt(definition, position.x[eid], position.y[eid], direction);
            for (const producer of engine.ports.getProducerEidsByPortEid(engine.ports.getPortEidAt(edge.x, edge.y, edge.direction))) {
                if (this._getOutLevelByEid(producer) === inLevel) {
                    eids.push(producer);
                    edges.push(edge);
                }
            }
        }
        return {eids, edges};
    }

    /**
     * A cell's link to its parent: the edge its chooseParent winner hands it, in the cell's own
     * frame, the port on it, and the winner when it also continues a lane into the cell. A cell with
     * no parent links on its straight back edge.
     * @private
     * @param {number} eid
     * @returns {ParentLink}
     */
    _getParentLinkByCellEid(eid) {
        const position = this.engine.Position;
        const direction = position.direction[eid];
        const candidates = this._getParentCandidatesByCellEid(eid);
        if (candidates.eids.length === 0) {
            return {edge: Direction.UP, portEid: this._getInputPortEidByCellEid(eid), parent: NO_EID};
        }
        // A lane cell outranks any other object, so a machine beside a head never cuts the line behind it.
        let contenders = candidates.eids.filter(candidateEid => this.cells.getRowByEid(candidateEid) >= 0);
        if (contenders.length === 0) {
            contenders = candidates.eids;
        }
        const winnerEid = this._getBehaviorByCellEid(eid).chooseParent(this.engine, contenders);
        const index = candidates.eids.indexOf(winnerEid);
        const edge = candidates.edges[index];
        let parentCellEid = NO_EID;
        if (this.cells.getRowByEid(winnerEid) >= 0
            && shouldConnectLevels(this._getOutLevelByEid(winnerEid), position.direction[winnerEid], this._getInLevelByEid(eid), direction)) {
            parentCellEid = winnerEid;
        }
        return {
            edge: Direction.rotate(edge.direction, 4 - direction),
            portEid: this.engine.ports.getPortEidAt(edge.x, edge.y, edge.direction),
            parent: parentCellEid,
        };
    }

    /**
     * The lane cells that are parents of `eid`, whose own lanes a change at `eid` can move.
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
     * Re-derives the lanes an object's output edges reach, so a machine placed or taken away beside
     * a lane head moves that head's parent edge and input port with it. Lane cells come through
     * {@link addCell} and {@link removeCell} instead, and a lane whose parent is unchanged is left
     * alone.
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
        for (const parentCellEid of this._getParentCellEidsByCellEid(eid)) {
            dirty.add(parentCellEid);
        }
        const childCellEid = this._getChildByCellEid(eid);
        if (childCellEid !== NO_EID) {
            dirty.add(childCellEid);
            for (const parentCellEid of this._getParentCellEidsByCellEid(childCellEid)) {
                dirty.add(parentCellEid);
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
        const droppedItems = itemSlotsByCellEid.get(dropped);
        if (droppedItems !== undefined) {
            this.items.destroyAll(droppedItems);
        }
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
            this.items.destroyAll(items);
        }
        for (const laneEid of built) {
            this._emitLaneCreated(laneEid);
            this._addLaneItemSyncs(laneEid);
        }
        this._flushBatches();
        // The port items the rebuild moved go out with its rows.
        this.engine.portItems.emitPortItemBatch();
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
        let startCellEid = eid;
        for (;;) {
            const parentCellEid = this._getParentByCellEid(startCellEid);
            if (parentCellEid === NO_EID || seen.has(parentCellEid) || this._getChunkKeyByEid(parentCellEid) !== chunkKey) {
                break;
            }
            if (this.getLaneRefByCellEid(parentCellEid) !== NO_LANE) {
                break;
            }
            seen.add(parentCellEid);
            startCellEid = parentCellEid;
        }
        const cells = [];
        let cellEid = startCellEid;
        while (cellEid !== NO_EID) {
            cells.push(cellEid);
            const childCellEid = this._getChildByCellEid(cellEid);
            if (childCellEid === NO_EID || this._getChunkKeyByEid(childCellEid) !== chunkKey) {
                break;
            }
            if (this._getParentByCellEid(childCellEid) !== cellEid || cells.includes(childCellEid)) {
                break;
            }
            cellEid = childCellEid;
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
        const tailCellEid = cells[cells.length - 1];
        const outputPortEid = this._getOutputPortEidByCellEid(tailCellEid);
        let slots = 0;
        for (const cellEid of cells) {
            slots += this._getBehaviorByCellEid(cellEid).slotsPerTile;
        }
        const laneEid = this.lanes.create(
            cells[0],
            this._getParentLinkByCellEid(cells[0]).portEid,
            outputPortEid,
            slots - 1,
        );
        for (let i = 0; i < cells.length; i += 1) {
            const cellRow = this.cells.getRowByEid(cells[i]);
            this.cells.store.lane[cellRow] = laneEid;
            const nextCellEid = i + 1 < cells.length ? cells[i + 1] : NO_EID;
            this.cells.store.childCell[cellRow] = nextCellEid;
            this.cells.store.parentEdge[cellRow] = this._getParentLinkByCellEid(cells[i]).edge;
        }
        const chunkKey = this._getChunkKeyByEid(cells[0]);
        let chunkLanes = this._lanesByChunk.get(chunkKey);
        if (chunkLanes === undefined) {
            chunkLanes = new Set();
            this._lanesByChunk.set(chunkKey, chunkLanes);
        }
        chunkLanes.add(laneEid);
        // The output port is the tail cell's last slot, so its item draws on the tail's tile
        // and routes to the lane's own chunk.
        const position = engine.Position;
        engine.portItems.addOutputPort(outputPortEid, position.x[tailCellEid], position.y[tailCellEid]);
        return laneEid;
    }

    /**
     * @private
     * @param {number} laneEid
     * @returns {void}
     */
    _destroyLane(laneEid) {
        const laneRow = this.lanes.getRowByLaneRef(laneEid);
        const lanes = this.lanes.store;
        for (const cell of this.getCellEidsByLaneRef(laneEid)) {
            const cellRow = this.cells.getRowByEid(cell);
            this.cells.store.lane[cellRow] = NO_EID;
            this.cells.store.childCell[cellRow] = NO_EID;
        }
        this.engine.portItems.removeOutputPort(lanes.outputPort[laneRow]);
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
        const laneRow = this.lanes.getRowByLaneRef(laneEid);
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
        this.lanes.resetFile(laneRow);
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
        const laneRow = this.lanes.getRowByLaneRef(laneEid);
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
        const laneRow = this.lanes.getRowByLaneRef(laneEid);
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
        const laneRow = this.lanes.getRowByLaneRef(laneEid);
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
            const inputPortEid = lanes.inputPort[laneRow];
            const inputPortItemTypeId = engine.ports.getItemByPortEid(inputPortEid);
            // A lane has one input; a resting fluid is refused, so its producer backs up.
            const inputPortTakeable = inputPortItemTypeId !== EMPTY && !engine.isFluid(inputPortItemTypeId);
            const leadItemEid = lanes.firstItem[laneRow];
            if (leadItemEid !== NO_EID && items.gap[this.items.getRowByEid(leadItemEid)] === 0 && this._canLanePop(laneRow)) {
                this._submitPop(laneRow, inputPortItemTypeId, items.itemTypeId[this.items.getRowByEid(leadItemEid)]);
            }
            if (inputPortTakeable && lanes.itemCount[laneRow] < lanes.slotCount[laneRow]) {
                this._drainItem[laneRow] = inputPortItemTypeId;
                this._drainIntent[laneRow] = engine.transfers.submitDrain(inputPortEid);
            }
        }
    }

    /**
     * Pops the lead item into the output port and drains the input port's item onto the lane.
     * @private
     * @param {number} laneRow
     * @param {number} inputPortItemTypeId
     * @param {number} leadItemTypeId
     * @returns {void}
     */
    _submitPop(laneRow, inputPortItemTypeId, leadItemTypeId) {
        const lanes = this.lanes.store;
        const transfers = this.engine.transfers;
        const outputPortEid = lanes.outputPort[laneRow];
        const isOutputPortEmpty = this.engine.ports.getItemByPortEid(outputPortEid) === EMPTY;
        if (this.engine.isFluid(inputPortItemTypeId)) {
            this._popSourceItem[laneRow] = EMPTY;
            this._popIntent[laneRow] = transfers.submitCreate(outputPortEid, leadItemTypeId, isOutputPortEmpty);
            return;
        }
        this._popSourceItem[laneRow] = inputPortItemTypeId;
        this._popIntent[laneRow] = transfers.submitTransfer(lanes.inputPort[laneRow], outputPortEid, isOutputPortEmpty, EMPTY, leadItemTypeId);
    }

    /**
     * Whether the lead may leave this tick: never into a fluid port. Whether the output port empties,
     * by being empty or by whatever is past it taking its item, is the resolver's question.
     * @private
     * @param {number} laneRow
     * @returns {boolean}
     */
    _canLanePop(laneRow) {
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
            const popped = this._popIntent[laneRow] !== NO_INTENT && transfers.isIntentResolved(this._popIntent[laneRow]);
            let takenItem = EMPTY;
            if (popped) {
                this._popLead(laneEid, laneRow);
                takenItem = this._popSourceItem[laneRow];
            } else {
                this._shiftItems(laneEid, laneRow);
            }
            // The item enters once, whichever intent emptied the port.
            if (takenItem === EMPTY && this._drainIntent[laneRow] !== NO_INTENT && transfers.isIntentResolved(this._drainIntent[laneRow])) {
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
        const leadItemEid = lanes.firstItem[laneRow];
        const itemRow = this.items.getRowByEid(leadItemEid);
        this._getBatchByLaneRow(laneRow).addDelete(laneEid, this.items.store.itemRef[itemRow]);
        lanes.firstItem[laneRow] = this.items.store.nextItem[itemRow];
        if (lanes.firstItem[laneRow] === NO_EID) {
            lanes.lastItem[laneRow] = NO_EID;
        }
        lanes.itemCount[laneRow] -= 1;
        lanes.headGap[laneRow] += 1;
        this.items.destroy(leadItemEid);
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
        const headCellEid = this.lanes.store.headCell[laneRow];
        return this._getBatchByChunkKey(this._getChunkKeyByEid(headCellEid), headCellEid);
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
            if (!batch.isEmpty && this.engine.isTileSubscribed(batch.x, batch.y)) {
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
        const laneRow = this.lanes.getRowByLaneRef(laneEid);
        const headCellEid = this.lanes.store.headCell[laneRow];
        const position = this.engine.Position;
        if (!this.engine.isTileSubscribed(position.x[headCellEid], position.y[headCellEid])) {
            return;
        }
        this.engine.emitEvent(new LaneCreatedEvent(
            position.x[headCellEid],
            position.y[headCellEid],
            laneEid,
            this.getCellEidsByLaneRef(laneEid).map(cellEid => this.engine.placed.getObjectRefByEid(cellEid)),
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
        const laneRow = this.lanes.getRowByLaneRef(laneEid);
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
            const laneRow = this.lanes.getRowByLaneRef(laneEid);
            const headCellEid = this.lanes.store.headCell[laneRow];
            if (geometry === null) {
                geometry = new LaneSyncBatchEvent(position.x[headCellEid], position.y[headCellEid]);
                items = new LaneItemBatchEvent(position.x[headCellEid], position.y[headCellEid]);
            }
            geometry.add(
                laneEid,
                this.getCellEidsByLaneRef(laneEid).map(cellEid => this.engine.placed.getObjectRefByEid(cellEid)),
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
            this.items.destroyAll(items);
        }
        this._batches.clear();
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
                if (eid !== NO_EID && items.getItemTypeByTypeIdOrNull(this.items.store.itemTypeId[this.items.getRowByEid(eid)]) === null) {
                    cellSlots[slot] = NO_EID;
                    this.items.destroy(eid);
                }
            }
        }
    }
}
