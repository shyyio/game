import {TickPhase, Direction, EMPTY, NO_EID, chunkId, chunkOrigin, tileId, getOrCreate, removeFromGroup} from "@/sdk/common.js";
import {findRampPartner} from "../common/geometry.js";
import {
    BeltPathBatchEvent,
    BeltPathRecalculateEvent,
    BeltItemSyncEvent,
    BeltItemResetEvent,
    BeltItemBatchEvent,
} from "../common/events.js";
import {
    BELT_NORMAL,
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
    LAYERS_UNDERGROUND_AXIS,
    beltPositionLayer,
} from "../common/constants.js";
import {ItemStore} from "./ItemStore.js";

// An empty half-tile in a path's occupancy.
const GAP = 0;

// Initial slot count for the per-path hot columns; grows by doubling.
const PATH_CAPACITY = 1024;

// Slot column value for a port that feeds no path.
const NO_SLOT = -1;


// Marks a live path entity; one shared object, since the world keys components by identity.
const PATH_MARKER = {};

/**
 * Belt path movement on the bitECS engine; a path carries a slab of the shared {@link ItemStore},
 * ordered output-edge -> input-edge, each item holding the empty half-tiles ahead of it.
 */
export class Belts {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        this.engine = engine;
        // Path records; `items` is held only while a path is not live (seed before tracking, snapshot after drop).
        this.paths = [];
        // Port eid -> slot of the path it feeds, so a path finds its downstream across a shared seam port.
        this._slotByInPort = this.engine.registerPortColumn(NO_SLOT);
        // Tile key -> covering paths, and belt id -> its path; keeps edits off a scan of every path.
        this._pathsByTile = new Map();
        this._pathByBeltId = new Map();
        // Hot per-path columns indexed by slot (records carry their slot, so a drop is a swap-pop).
        // `_colLeadGap` is the lead item's gap (-1 when empty), `_colFirstGap` the first item with
        // room ahead; both updated in place by the tick phases.
        this._pathCapacity = PATH_CAPACITY;
        this._colInPort = new Int32Array(PATH_CAPACITY);
        this._colOutPort = new Int32Array(PATH_CAPACITY);
        this._colHeadGap = new Int32Array(PATH_CAPACITY);
        this._colCount = new Int32Array(PATH_CAPACITY);
        this._colLeadGap = new Int32Array(PATH_CAPACITY);
        this._colFirstGap = new Int32Array(PATH_CAPACITY);
        // Whether the path's chunk has a watcher, cached at an observation generation (0 = never).
        this._colObserved = new Uint8Array(PATH_CAPACITY);
        this._colObservedGen = new Int32Array(PATH_CAPACITY);
        // The path's slab in the shared item store: base, span, and the slot holding the lead item.
        this._colItemBase = new Int32Array(PATH_CAPACITY);
        this._colItemSlab = new Int32Array(PATH_CAPACITY);
        this._colItemHead = new Int32Array(PATH_CAPACITY);
        // Out-port writes _move defers to its last phase, reused tick to tick.
        this._popCapacity = PATH_CAPACITY;
        this._popPorts = new Int32Array(PATH_CAPACITY);
        this._popTypes = new Int32Array(PATH_CAPACITY);
        // Placed belts by tile key; a tile can hold belts on different axes/layers, disambiguated by direction.
        this._belts = new Map();
        /**
         * Belt id -> belt.
         * @type {Map<number, {x:number, y:number, direction:number, type:number, id:number}>}
         */
        this._beltById = new Map();
        // Chunk -> the paths (by head tile) it holds; paths never cross a chunk seam.
        this._pathsByChunk = new Map();
        // Every live path's items, in three shared columns.
        this._items = new ItemStore();
        // Stable item id, the client's sprite key for continuity/glide.
        this._nextItemId = 1;

        // Runtime state lives in the JS maps above; these snapshotOnly components mirror it only at save/load.
        this._pathDef = engine.defineComponent("BeltPath", [
            {name: "inPort", kind: "eid", fill: NO_EID},
            {name: "outPort", kind: "eid", fill: NO_EID},
            {name: "headGap"},
            {name: "length"},
        ], {snapshotOnly: true});
        // Path membership only; a belt's position/direction/kind ride the PlacedObject snapshot.
        this._beltDef = engine.defineComponent("BeltPathMember", [
            {name: "path", kind: "eid", fill: NO_EID},
            {name: "seq"},
            {name: "objectId", fill: NO_EID},
        ], {snapshotOnly: true});
        this._itemDef = engine.defineComponent("BeltItem", [
            {name: "path", kind: "eid", fill: NO_EID},
            {name: "seq"},
            {name: "gap"},
            {name: "type"},
            {name: "itemId", fill: NO_EID},
        ], {snapshotOnly: true});
        engine.globals.beltNextItemId = this._nextItemId;

        // Underground axis layers, so crossing tunnels and a surface belt coexist on a tile.
        for (const layer of LAYERS_UNDERGROUND_AXIS) {
            engine.registerPositionLayer(layer);
        }

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._move());
        engine.registerSerializeHook(() => this._materialize());
        engine.registerRebuildHook(() => this._reconstruct());
        engine.registerPortPin(() => this._pinnedPorts());
        engine.registerChunkSync(chunk => this.chunkSync(chunk));
    }

    /**
     * @private
     * @param {number} x
     * @param {number} y
     * @returns {object[]} the belts on tile (x, y)
     */
    _beltsAt(x, y) {
        const held = this._belts.get(tileId(x, y));
        if (held === undefined) {
            return [];
        }
        return Array.isArray(held) ? held : [held];
    }

    /**
     * The belt on tile (x, y) facing `direction`, or undefined (same-axis overlap is disallowed).
     * @private
     * @param {number} x
     * @param {number} y
     * @param {number} direction
     * @returns {object|undefined}
     */
    _beltAt(x, y, direction) {
        return this._beltsAt(x, y).find(belt => belt.direction === direction);
    }

    /**
     * The belt `belt` flows into: the one continuing the flow on the tile ahead.
     * @private
     * @param {object} belt
     * @returns {object|undefined}
     */
    _flowInto(belt) {
        const ax = belt.x + Direction.dx(belt.direction);
        const ay = belt.y + Direction.dy(belt.direction);
        const ahead = this._beltsAt(ax, ay);
        // A tunnel continues on its own axis into an underground or ramp-up; everything else feeds a surface belt.
        if (belt.type === BELT_UNDERGROUND || belt.type === BELT_RAMP_DOWN) {
            return ahead.find(candidate =>
                (candidate.type === BELT_UNDERGROUND || candidate.type === BELT_RAMP_UP)
                && Direction.axis(candidate.direction) === Direction.axis(belt.direction));
        }
        return ahead.find(candidate => candidate.type !== BELT_UNDERGROUND);
    }

    /**
     * The belt feeding `belt`: the highest-id feeder wins, so a new belt steals a junction.
     * @private
     * @param {object} belt
     * @returns {object|undefined}
     */
    _chosenUpstream(belt) {
        let chosen;
        for (const direction of [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT]) {
            const fx = belt.x - Direction.dx(direction);
            const fy = belt.y - Direction.dy(direction);
            for (const feeder of this._beltsAt(fx, fy)) {
                if (this._flowInto(feeder) === belt && (chosen === undefined || feeder.id > chosen.id)) {
                    chosen = feeder;
                }
            }
        }
        return chosen;
    }

    /**
     * @private
     * @param {object} belt
     * @returns {void}
     */
    _addBelt(belt) {
        const key = tileId(belt.x, belt.y);
        const held = this._belts.get(key);
        if (held === undefined) {
            this._belts.set(key, belt);
        } else if (Array.isArray(held)) {
            held.push(belt);
        } else {
            this._belts.set(key, [held, belt]);
        }
        this._beltById.set(belt.id, belt);
    }

    /**
     * @private
     * @param {object} belt
     * @returns {void}
     */
    _removeBeltObject(belt) {
        const key = tileId(belt.x, belt.y);
        const remaining = this._beltsAt(belt.x, belt.y).filter(candidate => candidate !== belt);
        if (remaining.length === 0) {
            this._belts.delete(key);
        } else {
            this._belts.set(key, remaining.length === 1 ? remaining[0] : remaining);
        }
        this._beltById.delete(belt.id);
    }

    /**
     * @returns {number}
     */
    get beltCount() {
        return this._beltById.size;
    }

    /**
     * Registers a placed belt, (re)building the maximal in-line run it belongs to into one path.
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltType} [type]
     * @param {number} [id] - the belt's object id, allocated by the generic spawn path
     * @returns {{id:number, inPort:number, outPort:number, length:number, segments:number[]}|null} null
     *     when the target cell is taken
     */
    placeBelt(x, y, direction, type=BELT_NORMAL, id=undefined) {
        // An underground occupies its axis layer, so it can cross under a surface belt.
        const layer = beltPositionLayer(type, direction);
        if (!this.engine.cellsFree([{x, y, layer}])) {
            return null;
        }
        const placed = {x, y, direction, type, id: id === undefined ? this.engine.createObjectId() : id};
        this.engine.occupy([{x, y, layer}], placed.id);

        this._addBelt(placed);

        // Dropped overlapped paths can orphan belts outside this run; each rebuilds into its own path.
        const run = this._collectRun(placed);
        const {removed, orphans} = this._removePathsOverlapping(run);
        const result = this._buildRun(run, placed, removed);
        const rebuilt = this._rebuildOrphans(orphans, run, removed);

        // Recalc + item rows for every changed path (the run and any split-off orphan).
        const affected = [...run, ...rebuilt].map(belt => tileId(belt.x, belt.y));
        this._emitPathRecalcs(affected);
        this._emitPathItems(affected);
        return result;
    }

    /**
     * The ramp this placement would tunnel to; a same-kind ramp in between blocks the pairing.
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {BeltType} kind - BELT_RAMP_DOWN or BELT_RAMP_UP
     * @returns {{x:number, y:number, direction:number, type:number}|null}
     */
    rampPartner(x, y, direction, kind) {
        const belt = findRampPartner(x, y, direction, kind, (cx, cy) => this._beltsAt(cx, cy));
        if (belt === null) {
            return null;
        }
        return {x: belt.x, y: belt.y, direction: belt.direction, type: belt.type};
    }

    /**
     * Builds the run into one path, or empty seam-connected per-chunk paths (paths never cross a chunk border).
     * @private
     * @param {object[]} run - the run's belts, head -> tail
     * @param {object} placed - the belt just placed
     * @param {object[]} [removed] - the paths just dropped
     * @returns {{id:number, inPort:number, outPort:number, length:number, segments:number[]}}
     */
    _buildRun(run, placed, removed=[]) {
        const segments = this._segmentByChunk(run);
        if (segments.length === 1) {
            return this._buildSingleChunk(run, placed, removed);
        }
        return this._buildEmptyChain(segments);
    }

    /**
     * Rebuilds each uncovered orphaned belt into its own path, carrying the items that sat on its belts.
     * @private
     * @param {object[]} orphans - belts dropped from removed paths, not in the run
     * @param {object[]} run - the run's belts (already rebuilt)
     * @param {object[]} removed - the source paths
     * @returns {object[]} the belts of the rebuilt orphan paths
     */
    _rebuildOrphans(orphans, run, removed) {
        const covered = new Set(run.map(belt => belt.id));
        const rebuilt = [];
        for (const orphan of orphans) {
            if (covered.has(orphan.id)) {
                continue;
            }
            const orphanRun = this._collectRun(orphan);
            this._rebuildSubrun(orphanRun, removed);
            for (const belt of orphanRun) {
                covered.add(belt.id);
                rebuilt.push(belt);
            }
        }
        return rebuilt;
    }

    /**
     * Rebuilds a split-off sub-run, keeping items only when single-chunk and fully contained by one source path.
     * @private
     * @param {object[]} run - the sub-run's belts, head -> tail
     * @param {object[]} sourcePaths - the dropped paths to carry items from
     * @returns {void}
     */
    _rebuildSubrun(run, sourcePaths) {
        const segments = this._segmentByChunk(run);
        if (segments.length === 1) {
            const from = sourcePaths.find(path => run.every(runBelt => path.beltIds.includes(runBelt.id)));
            const state = from === undefined ? {items: []} : this._carryItemsForSubrun(from, run);
            this._trackPath(this._makePath(run, state));
        } else {
            this._buildEmptyChain(segments);
        }
    }

    /**
     * Emits a path-recalc event for every path covering one of `tileKeys`.
     * @private
     * @param {number[]} tileKeys
     * @returns {void}
     */
    _emitPathRecalcs(tileKeys) {
        for (const path of this._pathsCovering(tileKeys)) {
            this.engine.emitEvent(this._pathRecalcEvent(path));
        }
    }

    /**
     * Re-emits the item rows of every path covering one of `tileKeys`, after the path-recalc.
     * @private
     * @param {number[]} tileKeys
     * @returns {void}
     */
    _emitPathItems(tileKeys) {
        for (const path of this._pathsCovering(tileKeys)) {
            // Re-sync (snap), not upsert (glide): the edit re-rowed the items but didn't move them.
            for (const item of this._unloadItems(path.slot)) {
                this.engine.emitEvent(this._itemSyncEvent(path, item.id, item.gap, item.type));
            }
        }
    }

    /**
     * The path-recalc event: belt ids in path order (head last) and out-port id, routed by the head tile.
     * @private
     * @param {object} path
     * @returns {BeltPathRecalculateEvent}
     */
    _pathRecalcEvent(path) {
        const parts = [...path.beltIds].reverse();
        return new BeltPathRecalculateEvent(path.headX, path.headY, parts, path.outPort);
    }

    /**
     * The client path id (head belt id) and head tile.
     * @private
     * @param {object} path
     * @returns {{pathId: number, x: number, y: number}}
     */
    _headInfo(path) {
        return {
            pathId: path.beltIds[0],
            x: path.headX,
            y: path.headY,
        };
    }

    /**
     * Buffers the upsert for the item in store cell `cell`; an unobserved path reads none of its fields.
     * @private
     * @param {Map<number, BeltItemBatchEvent>} batches
     * @param {number} slot
     * @param {number} cell
     * @returns {void}
     */
    _bufferItemAt(batches, slot, cell) {
        if (!this._observedAt(slot)) {
            return;
        }
        const head = this._headInfo(this.paths[slot]);
        this._itemBatch(batches, head).addUpsert(
            head.pathId,
            this._items.ids[cell],
            this._items.gaps[cell],
            this._items.types[cell],
        );
    }

    /**
     * The batch collecting a path head's chunk, created on first use.
     * @private
     * @param {Map<number, BeltItemBatchEvent>} batches
     * @param {{pathId: number, x: number, y: number}} head
     * @returns {BeltItemBatchEvent}
     */
    _itemBatch(batches, head) {
        const chunk = chunkId(head.x, head.y);
        const existing = batches.get(chunk);
        if (existing !== undefined) {
            return existing;
        }
        const batch = new BeltItemBatchEvent(head.x, head.y);
        batches.set(chunk, batch);
        return batch;
    }


    /**
     * Whether the path in `slot` has a watcher, cached per observation generation.
     * @private
     * @param {number} slot
     * @returns {boolean}
     */
    _observedAt(slot) {
        const generation = this.engine.observerGeneration;
        if (this._colObservedGen[slot] === generation) {
            return this._colObserved[slot] === 1;
        }
        const path = this.paths[slot];
        const observed = path.belts !== undefined && this.engine.observesTile(path.headX, path.headY);
        this._colObservedGen[slot] = generation;
        this._colObserved[slot] = observed ? 1 : 0;
        return observed;
    }

    /**
     * The re-sync for one of a path's items: a snap in place.
     * @private
     * @param {object} path
     * @param {number} itemId
     * @param {number} gap
     * @param {number} type
     * @returns {BeltItemSyncEvent}
     */
    _itemSyncEvent(path, itemId, gap, type) {
        const head = this._headInfo(path);
        return new BeltItemSyncEvent(head.x, head.y, head.pathId, itemId, gap, type);
    }

    /**
     * Buffers the delete for the popping lead item; an unobserved path reads nothing.
     * @private
     * @param {Map<number, BeltItemBatchEvent>} batches
     * @param {number} slot
     * @param {number} cell
     * @returns {void}
     */
    _bufferPoppedItem(batches, slot, cell) {
        if (!this._observedAt(slot)) {
            return;
        }
        const head = this._headInfo(this.paths[slot]);
        this._itemBatch(batches, head).addDelete(head.pathId, this._items.ids[cell]);
    }

    /**
     * @private
     * @param {object} path
     * @returns {void}
     */
    _emitItemReset(path) {
        const head = this._headInfo(path);
        this.engine.emitEvent(new BeltItemResetEvent(head.x, head.y, head.pathId));
    }

    /**
     * Removes the belt at (x, y) facing `direction`, rebuilding the surviving runs on each side.
     * @param {number} x
     * @param {number} y
     * @param {number} direction
     * @returns {void}
     */
    removeBelt(x, y, direction) {
        const belt = this._beltAt(x, y, direction);
        if (belt === undefined) {
            return;
        }
        const removedId = belt.id;
        this.engine.destroyCells([{x, y, layer: beltPositionLayer(belt.type, direction)}]);

        // Anchors for the surviving runs, captured while the flow links are intact.
        const neighbors = [];
        const ahead = this._flowInto(belt);
        if (ahead !== undefined) {
            neighbors.push(ahead);
        }
        for (const d of [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT]) {
            for (const feeder of this._beltsAt(x - Direction.dx(d), y - Direction.dy(d))) {
                if (this._flowInto(feeder) === belt) {
                    neighbors.push(feeder);
                }
            }
        }

        // Capture the holding path before dropping it, so each sub-run keeps the items on its belts.
        const held = this._pathByBeltId.get(removedId);
        const source = held === undefined ? [] : [held];
        if (held !== undefined) {
            this._forgetPath(held);
        }
        this._removeBeltObject(belt);

        // Rebuild each surviving neighbor's run into its own path, carrying its items.
        const covered = new Set();
        const affected = [];
        for (const neighbor of neighbors) {
            if (covered.has(neighbor.id) || this.beltById(neighbor.id) === null) {
                continue;
            }
            const run = this._collectRun(neighbor);
            const {removed, orphans} = this._removePathsOverlapping(run);
            const sources = [...source, ...removed];
            this._rebuildSubrun(run, sources);
            for (const runBelt of run) {
                covered.add(runBelt.id);
                affected.push(tileId(runBelt.x, runBelt.y));
            }
            for (const runBelt of this._rebuildOrphans(orphans, run, sources)) {
                affected.push(tileId(runBelt.x, runBelt.y));
            }
        }
        this._emitPathRecalcs(affected);
        this._emitPathItems(affected);
    }

    /**
     * Removes the belt with client-facing `id`, if it is one of this module's belts.
     * @param {number} id
     * @returns {boolean} whether a belt was removed
     */
    removeBeltById(id) {
        const target = this.beltById(id);
        if (target === null) {
            return false;
        }
        this.removeBelt(target.x, target.y, target.direction);
        return true;
    }

    /**
     * The undergrounds buried in `ramp`'s tunnel (not the paired ramp).
     * @param {object} ramp
     * @returns {object[]}
     */
    tunnelUndergrounds(ramp) {
        const undergrounds = [];
        const step = ramp.type === BELT_RAMP_DOWN
            ? belt => this._flowInto(belt)
            : belt => this._chosenUpstream(belt);
        let current = step(ramp);
        while (current !== undefined && current.type === BELT_UNDERGROUND) {
            undergrounds.push(current);
            current = step(current);
        }
        return undergrounds;
    }

    /**
     * The placed belt with client-facing `id`, or null.
     * @param {number} id
     * @returns {{x:number, y:number, direction:number, type:number, id:number}|null}
     */
    beltById(id) {
        const found = this._beltById.get(id);
        return found === undefined ? null : found;
    }

    /**
     * Splits a run (ordered head -> tail) into maximal contiguous same-chunk segments.
     * @private
     * @param {{x:number, y:number}[]} run
     * @returns {{x:number, y:number}[][]}
     */
    _segmentByChunk(run) {
        const segments = [];
        let current = [];
        let currentChunk = null;
        for (const cell of run) {
            const chunk = chunkId(cell.x, cell.y);
            if (chunk !== currentChunk && current.length > 0) {
                segments.push(current);
                current = [];
            }
            currentChunk = chunk;
            current.push(cell);
        }
        if (current.length > 0) {
            segments.push(current);
        }
        return segments;
    }

    /**
     * The path's per-half-tile occupancy, indexed from the input edge.
     * @private
     * @param {object} path
     * @returns {number[]}
     */
    _occupancyFromInput(path) {
        const occ = new Array(path.length).fill(GAP);
        // Item gaps count from the output edge inward, so walk that way and mirror each index.
        let pos = 0;
        for (const item of path.items) {
            pos += item.gap;
            occ[path.length - 1 - pos] = item.type;
            pos += 1;
        }
        return occ;
    }

    /**
     * Rebuilds `{items, headGap}` from an input-indexed occupancy slice, walking in from the output edge.
     * @private
     * @param {number[]} occ
     * @returns {{items:object[], headGap:number}}
     */
    _itemsFromOccupancy(occ) {
        const items = [];
        let gap = 0;
        for (let i = occ.length - 1; i >= 0; i -= 1) {
            if (occ[i] === GAP) {
                gap += 1;
                continue;
            }
            items.push({id: this._nextItemId, type: occ[i], gap});
            this._nextItemId += 1;
            gap = 0;
        }
        return {items, headGap: gap};
    }

    /**
     * The items for a run merging removed paths; a buried resting port item re-enters at its internal boundary.
     * @private
     * @param {object[]} run - the merged run's belts, head -> tail
     * @param {object[]} removed - the paths folded into it
     * @returns {{items:object[], headGap:number}}
     */
    _mergedItems(run, removed) {
        const newIndex = new Map(run.map((belt, i) => [belt.id, i]));
        const occ = new Array(run.length * 2 - 1).fill(GAP);

        for (const path of removed) {
            const sourceOcc = this._occupancyFromInput(path);
            for (const [oldIdx, id] of path.beltIds.entries()) {
                const j = newIndex.get(id);
                if (j === undefined) {
                    continue;
                }
                // Output half carries the content; an input half carries over only when both runs have one.
                occ[j === 0 ? 0 : 2 * j] = sourceOcc[oldIdx === 0 ? 0 : 2 * oldIdx];
                if (j > 0 && oldIdx > 0) {
                    occ[2 * j - 1] = sourceOcc[2 * oldIdx - 1];
                }
            }

            // A resting out-port item buried by the merge re-enters at the downstream belt's input half.
            const outItem = this.engine.Port.item[path.outPort];
            const tail = newIndex.get(path.beltIds[path.beltIds.length - 1]);
            if (outItem !== EMPTY && tail !== undefined && tail + 1 < run.length) {
                occ[2 * (tail + 1) - 1] = outItem;
                this.engine.setPortItem(path.outPort, EMPTY);
            }
            // A resting in-port item buried by the merge re-enters at the head belt's input half.
            const inItem = this.engine.Port.item[path.inPort];
            const head = newIndex.get(path.beltIds[0]);
            if (inItem !== EMPTY && head !== undefined && head > 0) {
                occ[2 * head - 1] = inItem;
                this.engine.setPortItem(path.inPort, EMPTY);
            }
        }

        return this._itemsFromOccupancy(occ);
    }

    /**
     * The items carried onto a sub-run split off `sourcePath`; empty unless a contiguous slice of the source.
     * @private
     * @param {object} sourcePath
     * @param {object[]} subRunBelts
     * @returns {{items:object[], headGap?:number}}
     */
    _carryItemsForSubrun(sourcePath, subRunBelts) {
        const indices = subRunBelts.map(belt => sourcePath.beltIds.indexOf(belt.id));
        const a = Math.min(...indices);
        const b = Math.max(...indices);
        if (indices.some(index => index < 0) || indices.length !== b - a + 1) {
            return {items: []};
        }
        const occ = this._occupancyFromInput(sourcePath);
        const startSlot = a === 0 ? 0 : 2 * a;
        return this._itemsFromOccupancy(occ.slice(startSlot, 2 * b + 1));
    }

    /**
     * A new path record over `runBelts` (head -> tail) with the given items/head-gap.
     * @private
     * @param {object[]} runBelts
     * @param {{items:{id:number, type:number, gap:number}[], headGap?:number}} state
     * @returns {object}
     */
    _makePath(runBelts, {items, headGap}) {
        const ports = this._pathPorts(runBelts);
        let inPort = ports.inPort;
        const outPort = ports.outPort;
        // A closed loop shares one port for both ends, so the popped lead re-ingests and items circulate.
        if (runBelts.length > 1 && this._flowInto(runBelts[runBelts.length - 1]) === runBelts[0]) {
            inPort = outPort;
        }
        const length = runBelts.length * 2 - 1;
        const eid = this.engine.world.addEntity();
        this.engine.world.addComponent(eid, PATH_MARKER);
        return {
            id: eid,
            belts: runBelts.map(belt => tileId(belt.x, belt.y)),
            beltIds: runBelts.map(belt => belt.id),
            headX: runBelts[0].x,
            headY: runBelts[0].y,
            tailX: runBelts[runBelts.length - 1].x,
            tailY: runBelts[runBelts.length - 1].y,
            inPort,
            outPort,
            length,
            initialHeadGap: headGap === undefined ? length : headGap,
            items,
        };
    }

    /**
     * Builds a per-chunk chain of empty seam-connected paths (each segment's out-port is the next's in-port).
     * @private
     * @param {object[][]} segments - the run's belts split into per-chunk segments, head -> tail
     * @returns {{id:number, inPort:number, outPort:number, length:number, segments:number[]}}
     */
    _buildEmptyChain(segments) {
        const built = segments.map(segment => this._makePath(segment, {items: []}));
        for (const path of built) {
            this._trackPath(path);
        }

        return {
            id: built[0].id,
            inPort: built[0].inPort,
            outPort: built[built.length - 1].outPort,
            length: built.reduce((sum, path) => sum + path.length, 0),
            segments: built.map(path => path.id),
        };
    }

    /**
     * The run's in/out edge ports via {@link GameEngine#portAt}, so seams and adjacent objects adopt them.
     * @private
     * @param {object[]} runBelts - the run's belts, head -> tail
     * @returns {{inPort:number, outPort:number}}
     */
    _pathPorts(runBelts) {
        const head = runBelts[0];
        const tail = runBelts[runBelts.length - 1];
        return {
            inPort: this.engine.portAt(head.x, head.y, head.direction),
            outPort: this.engine.portAt(
                tail.x + Direction.dx(tail.direction),
                tail.y + Direction.dy(tail.direction),
                tail.direction,
            ),
        };
    }

    /**
     * Builds the single-chunk run into one path, preserving items when it end-extends one removed path.
     * @private
     * @param {object[]} run - the run's belts, head -> tail
     * @param {object} placed - the belt just placed
     * @param {object[]} removed - the paths just dropped
     * @returns {{id:number, inPort:number, outPort:number, length:number, segments:number[]}}
     */
    _buildSingleChunk(run, placed, removed) {
        const runKeys = run.map(belt => tileId(belt.x, belt.y));
        const newKey = tileId(placed.x, placed.y);

        // Only extending one path at an end preserves its in-flight items; anything else rebuilds empty.
        let items = [];
        let headGap = run.length * 2 - 1;
        const extension = removed.length === 1 && this._isEndExtension(runKeys, removed[0].belts, newKey)
            ? removed[0]
            : null;
        if (extension !== null) {
            const old = extension;
            if (runKeys[0] === newKey) {
                // Head extension: the new belt is headroom; items keep their distance from the output edge.
                items = old.items;
                headGap = old.initialHeadGap + 2;
            } else {
                // Tail extension: items keep their distance from the input edge.
                const carried = old.items;
                const resting = this.engine.Port.item[old.outPort];
                if (resting !== EMPTY) {
                    // A resting out-port item re-enters one half-tile from the moved out-port, keeping its position.
                    items = [{id: this._nextItemId, type: resting, gap: 1}, ...carried];
                    this._nextItemId += 1;
                    headGap = old.initialHeadGap;
                    this.engine.setPortItem(old.outPort, EMPTY);
                } else if (carried.length === 0) {
                    // Empty path: all the new space is headroom.
                    items = [];
                    headGap = old.initialHeadGap + 2;
                } else {
                    // In-flight items: the two new half-tiles widen the lead item's gap.
                    carried[0].gap += 2;
                    items = carried;
                    headGap = old.initialHeadGap;
                }
            }
        } else if (removed.length > 0) {
            // A merge: reconstruct the items from each belt's half-tile content.
            ({items, headGap} = this._mergedItems(run, removed));
        }

        // Renumber in array order: the client sorts items by id, ascending = output -> input.
        items = items.map(item => {
            const renumbered = {id: this._nextItemId, type: item.type, gap: item.gap};
            this._nextItemId += 1;
            return renumbered;
        });

        const path = this._makePath(run, {items, headGap});
        this._trackPath(path);

        return {id: path.id, inPort: path.inPort, outPort: path.outPort, length: path.length, segments: [path.id]};
    }

    /**
     * Whether `runKeys` is `oldBelts` plus `newKey` appended at one end (a pure extension).
     * @private
     * @param {number[]} runKeys - the run ordered head -> tail
     * @param {number[]} oldBelts
     * @param {number} newKey
     * @returns {boolean}
     */
    _isEndExtension(runKeys, oldBelts, newKey) {
        if (runKeys.length !== oldBelts.length + 1) {
            return false;
        }
        const withoutNew = runKeys.filter(key => key !== newKey);
        return withoutNew.every((key, index) => key === oldBelts[index]);
    }

    /**
     * The path currently covering tile (x, y), or null.
     * @param {number} x
     * @param {number} y
     * @returns {{id:number, inPort:number, outPort:number}|null}
     */
    pathAt(x, y) {
        const held = this._pathsByTile.get(tileId(x, y));
        const path = Array.isArray(held) ? held[0] : held;
        if (path === undefined) {
            return null;
        }
        return {id: path.id, inPort: path.inPort, outPort: path.outPort};
    }

    /**
     * The run through `belt`, head -> tail; a junction ends the run where the downstream's chosen upstream diverges.
     * @private
     * @param {object} belt
     * @returns {object[]} the run's belts, head -> tail
     */
    _collectRun(belt) {
        // Walk upstream to the head, stopping at a loop or a diverging chosen upstream.
        let head = belt;
        const upstream = new Set([head.id]);
        for (;;) {
            const up = this._chosenUpstream(head);
            if (up === undefined || this._flowInto(up) !== head || upstream.has(up.id)) {
                break;
            }
            upstream.add(up.id);
            head = up;
        }

        // Collect downstream from the head, stopping where the flow leaves the run.
        const run = [];
        const seen = new Set();
        let current = head;
        while (current !== undefined && !seen.has(current.id)) {
            seen.add(current.id);
            run.push(current);
            const next = this._flowInto(current);
            if (next === undefined || this._chosenUpstream(next) !== current) {
                break;
            }
            current = next;
        }
        return run;
    }

    /**
     * Drops any path sharing a belt id with `run` (a crossing perpendicular path survives).
     * @private
     * @param {object[]} run - the run's belts
     * @returns {{removed: object[], orphans: object[]}}
     */
    _removePathsOverlapping(run) {
        const runIds = new Set(run.map(belt => belt.id));
        const overlapping = new Set();
        for (const belt of run) {
            const path = this._pathByBeltId.get(belt.id);
            if (path !== undefined) {
                overlapping.add(path);
            }
        }
        if (overlapping.size === 0) {
            return {removed: [], orphans: []};
        }

        const removed = [];
        const orphans = [];
        for (const path of overlapping) {
            for (const id of path.beltIds) {
                if (!runIds.has(id)) {
                    const belt = this.beltById(id);
                    if (belt !== null) {
                        orphans.push(belt);
                    }
                }
            }
            this._forgetPath(path);
            removed.push(path);
        }
        return {removed, orphans};
    }

    /**
     * The port eids the live paths still reference, so the engine's port sweep keeps them.
     * @private
     * @returns {number[]}
     */
    _pinnedPorts() {
        const ports = [];
        for (const path of this.paths) {
            ports.push(path.inPort, path.outPort);
        }
        return ports;
    }

    /**
     * Records a new path and registers its out-port for item rendering (drawn at the tail tile).
     * @private
     * @param {object} path
     * @returns {void}
     */
    _trackPath(path) {
        this._pushPath(path);
        this._slotByInPort.column[path.inPort] = path.slot;
        this._indexPath(path);
        this.engine.registerRenderedPort(path.outPort, path.tailX, path.tailY);
    }

    /**
     * Appends a path to `paths`, recording its slot.
     * @private
     * @param {object} path
     * @returns {void}
     */
    _pushPath(path) {
        const slot = this.paths.length;
        this._growColumns(slot);
        path.slot = slot;
        this.paths.push(path);
        this._colInPort[slot] = path.inPort;
        this._colOutPort[slot] = path.outPort;
        this._colHeadGap[slot] = path.initialHeadGap;
        this._colObservedGen[slot] = 0;
        this._loadItems(slot, path);
    }

    /**
     * Moves seed items into a slab as wide as the path (it can never hold more items than half-tiles).
     * @private
     * @param {number} slot
     * @param {object} path
     * @returns {void}
     */
    _loadItems(slot, path) {
        const seed = path.items;
        const base = this._items.allocate(path.length);
        this._colItemBase[slot] = base;
        this._colItemSlab[slot] = path.length;
        this._colItemHead[slot] = 0;
        this._colCount[slot] = seed.length;
        const ids = this._items.ids;
        const types = this._items.types;
        const gaps = this._items.gaps;
        for (let index = 0; index < seed.length; index += 1) {
            ids[base + index] = seed[index].id;
            types[base + index] = seed[index].type;
            gaps[base + index] = seed[index].gap;
        }
        path.items = null;
        this._refreshLeadColumns(slot);
    }

    /**
     * The path's items output edge -> input edge, read out of its slab.
     * @private
     * @param {number} slot
     * @returns {{id:number, type:number, gap:number}[]}
     */
    _unloadItems(slot) {
        const base = this._colItemBase[slot];
        const slab = this._colItemSlab[slot];
        const head = this._colItemHead[slot];
        const count = this._colCount[slot];
        const items = [];
        for (let index = 0; index < count; index += 1) {
            let at = head + index;
            if (at >= slab) {
                at -= slab;
            }
            items.push({
                id: this._items.ids[base + at],
                type: this._items.types[base + at],
                gap: this._items.gaps[base + at],
            });
        }
        return items;
    }

    /**
     * The items of `path`, live or dropped.
     * @param {object} path
     * @returns {{id:number, type:number, gap:number}[]} ordered output edge -> input edge
     */
    itemsOf(path) {
        const slot = path.slot;
        return slot === undefined ? path.items : this._unloadItems(slot);
    }

    /**
     * @param {object} path
     * @returns {number} how many items `path` carries
     */
    itemCountOf(path) {
        const slot = path.slot;
        return slot === undefined ? path.items.length : this._colCount[slot];
    }

    /**
     * Grows the hot columns so `slot` is addressable.
     * @private
     * @param {number} slot
     * @returns {void}
     */
    _growColumns(slot) {
        if (slot < this._pathCapacity) {
            return;
        }
        let capacity = this._pathCapacity;
        while (capacity <= slot) {
            capacity *= 2;
        }
        for (const name of ["_colInPort", "_colOutPort", "_colHeadGap", "_colCount", "_colLeadGap", "_colFirstGap", "_colObservedGen", "_colItemBase", "_colItemSlab", "_colItemHead"]) {
            const grown = new Int32Array(capacity);
            grown.set(this[name]);
            this[name] = grown;
        }
        const grownObserved = new Uint8Array(capacity);
        grownObserved.set(this._colObserved);
        this._colObserved = grownObserved;
        this._pathCapacity = capacity;
    }

    /**
     * The first item at or after `from` with room ahead, or -1; it only walks forward, so amortized O(1).
     * @private
     * @param {number} slot
     * @param {number} from
     * @returns {number}
     */
    _nextPositiveGap(slot, from) {
        const base = this._colItemBase[slot];
        const slab = this._colItemSlab[slot];
        const head = this._colItemHead[slot];
        const count = this._colCount[slot];
        const gaps = this._items.gaps;
        for (let index = from; index < count; index += 1) {
            let at = head + index;
            if (at >= slab) {
                at -= slab;
            }
            if (gaps[base + at] > 0) {
                return index;
            }
        }
        return -1;
    }

    /**
     * Recomputes lead columns by scanning the slab; only for wholesale item sets, the tick updates in place.
     * @private
     * @param {number} slot
     * @returns {void}
     */
    _refreshLeadColumns(slot) {
        const count = this._colCount[slot];
        if (count === 0) {
            this._colLeadGap[slot] = -1;
            this._colFirstGap[slot] = -1;
            return;
        }
        const base = this._colItemBase[slot];
        const slab = this._colItemSlab[slot];
        const head = this._colItemHead[slot];
        const gaps = this._items.gaps;
        this._colLeadGap[slot] = gaps[base + head];
        this._colFirstGap[slot] = -1;
        for (let index = 0; index < count; index += 1) {
            let at = head + index;
            if (at >= slab) {
                at -= slab;
            }
            if (gaps[base + at] > 0) {
                this._colFirstGap[slot] = index;
                return;
            }
        }
    }

    /**
     * Drops a path from `paths` by moving the last entry into its slot.
     * @private
     * @param {object} path
     * @returns {void}
     */
    _popPath(path) {
        const slot = path.slot;
        if (slot === undefined) {
            return;
        }
        // Snapshot live head-gap and items onto the record; the replacing edit still reads a dropped path.
        path.initialHeadGap = this._colHeadGap[slot];
        path.items = this._unloadItems(slot);
        this._items.free(this._colItemBase[slot], this._colItemSlab[slot]);
        const lastSlot = this.paths.length - 1;
        const last = this.paths[lastSlot];
        this.paths[slot] = last;
        last.slot = slot;
        this._colInPort[slot] = this._colInPort[lastSlot];
        this._colOutPort[slot] = this._colOutPort[lastSlot];
        this._colHeadGap[slot] = this._colHeadGap[lastSlot];
        this._colObserved[slot] = this._colObserved[lastSlot];
        this._colObservedGen[slot] = this._colObservedGen[lastSlot];
        this._colCount[slot] = this._colCount[lastSlot];
        this._colLeadGap[slot] = this._colLeadGap[lastSlot];
        this._colFirstGap[slot] = this._colFirstGap[lastSlot];
        this._colItemBase[slot] = this._colItemBase[lastSlot];
        this._colItemSlab[slot] = this._colItemSlab[lastSlot];
        this._colItemHead[slot] = this._colItemHead[lastSlot];
        // The moved path's in-port now maps to its new slot.
        this._slotByInPort.column[last.inPort] = slot;
        this.paths.pop();
        // Last, so popping the tail (where the path is its own `last`) still leaves it slotless.
        path.slot = undefined;
    }

    /**
     * Adds a path to the tile and belt-id indexes.
     * @private
     * @param {object} path
     * @returns {void}
     */
    _indexPath(path) {
        for (const key of path.belts) {
            const covering = this._pathsByTile.get(key);
            if (covering === undefined) {
                this._pathsByTile.set(key, path);
            } else if (Array.isArray(covering)) {
                if (!covering.includes(path)) {
                    covering.push(path);
                }
            } else if (covering !== path) {
                this._pathsByTile.set(key, [covering, path]);
            }
        }
        for (const id of path.beltIds) {
            this._pathByBeltId.set(id, path);
        }
        getOrCreate(this._pathsByChunk, chunkId(path.headX, path.headY), () => new Set()).add(path);
    }

    /**
     * @private
     * @param {object} path
     * @returns {void}
     */
    _unindexPath(path) {
        for (const key of path.belts) {
            const covering = this._pathsByTile.get(key);
            if (covering === undefined) {
                continue;
            }
            if (!Array.isArray(covering)) {
                if (covering === path) {
                    this._pathsByTile.delete(key);
                }
                continue;
            }
            const at = covering.indexOf(path);
            if (at !== -1) {
                covering.splice(at, 1);
            }
            if (covering.length === 1) {
                this._pathsByTile.set(key, covering[0]);
            } else if (covering.length === 0) {
                this._pathsByTile.delete(key);
            }
        }
        removeFromGroup(this._pathsByChunk, chunkId(path.headX, path.headY), path);
        for (const id of path.beltIds) {
            if (this._pathByBeltId.get(id) === path) {
                this._pathByBeltId.delete(id);
            }
        }
    }

    /**
     * The distinct paths covering any of `tileKeys`.
     * @private
     * @param {number[]} tileKeys
     * @returns {object[]}
     */
    _pathsCovering(tileKeys) {
        const covering = new Set();
        for (const key of new Set(tileKeys)) {
            const held = this._pathsByTile.get(key);
            if (held === undefined) {
                continue;
            }
            if (Array.isArray(held)) {
                for (const path of held) {
                    covering.add(path);
                }
            } else {
                covering.add(held);
            }
        }
        return [...covering];
    }

    /**
     * Drops a path's indexes, render registration, and its entity.
     * @private
     * @param {object} path
     * @returns {void}
     */
    _forgetPath(path) {
        this._popPath(path);
        this._slotByInPort.column[path.inPort] = NO_SLOT;
        this._unindexPath(path);
        this.engine.unregisterRenderedPort(path.outPort);
        // Clear the client's item sprites for the stale path id.
        this._emitItemReset(path);
        this.engine.destroyEntity(path.id);
    }

    /**
     * SUBMIT_INTENTS: a lead item submits its out-port shift; a path with room declares its in-port drainable.
     * @private
     * @returns {void}
     */
    _submitIntents() {
        const P = this.engine.Port.item;
        const engine = this.engine;
        const inPortCol = this._colInPort;
        const outPortCol = this._colOutPort;
        const headGapCol = this._colHeadGap;
        const firstGapCol = this._colFirstGap;
        const leadGapCol = this._colLeadGap;
        const slotByInPort = this._slotByInPort.column;
        const count = this.paths.length;
        for (let slot = 0; slot < count; slot += 1) {
            const firstGap = firstGapCol[slot];
            const inPort = inPortCol[slot];
            const outPort = outPortCol[slot];
            const leadIsItem = leadGapCol[slot] === 0;
            if (leadIsItem) {
                // Free if empty or the downstream can ingest, so the resolver's chain shifts a packed run at once.
                const downstream = slotByInPort[outPort];
                const downstreamCanIngest = downstream !== NO_SLOT
                    && (headGapCol[downstream] > 0 || firstGapCol[downstream] !== -1);
                engine.submitTransfer(
                    inPort,
                    outPort,
                    P[outPort] === EMPTY || downstreamCanIngest,
                    false,
                );
            }
            if (P[inPort] !== EMPTY && (headGapCol[slot] > 0 || firstGap !== -1)) {
                engine.submitDrain(inPort, false);
            }
        }
    }

    /**
     * POST_RESOLVE: move each path one half-tile, then ingest a resting in-port item at the input edge.
     * @private
     * @returns {void}
     */
    _move() {
        const P = this.engine.Port.item;

        // Phase 1: move each path one half-tile; out-port writes deferred so a shared seam still
        // holds last tick's value.
        const engine = this.engine;
        const inPortCol = this._colInPort;
        const outPortCol = this._colOutPort;
        const headGapCol = this._colHeadGap;
        const countCol = this._colCount;
        const leadGapCol = this._colLeadGap;
        const firstGapCol = this._colFirstGap;
        const baseCol = this._colItemBase;
        const slabCol = this._colItemSlab;
        const headCol = this._colItemHead;
        const itemTypes = this._items.types;
        const itemGaps = this._items.gaps;
        const count = this.paths.length;
        // Deferred out-port writes, reused across ticks.
        let popCount = 0;
        // One batch per chunk, flushed at the end so the pass stays ordered against outside emits.
        const batches = new Map();

        for (let slot = 0; slot < count; slot += 1) {
            const firstGap = firstGapCol[slot];
            const canPop = leadGapCol[slot] === 0 && engine.resolvedUnmanagedDest(outPortCol[slot]);
            if (!canPop && firstGap === -1) {
                continue;
            }

            // Only a moving path reaches into the item store.
            const base = baseCol[slot];
            const slab = slabCol[slot];
            const head = headCol[slot];
            if (canPop) {
                this._growPops(popCount);
                this._popPorts[popCount] = outPortCol[slot];
                this._popTypes[popCount] = itemTypes[base + head];
                popCount += 1;
                this._bufferPoppedItem(batches, slot, base + head);
                // Gaps are relative: dropping the lead advances everything behind it.
                const nextHead = head + 1 === slab ? 0 : head + 1;
                const remaining = countCol[slot] - 1;
                headCol[slot] = nextHead;
                countCol[slot] = remaining;
                leadGapCol[slot] = remaining === 0 ? -1 : itemGaps[base + nextHead];
                firstGapCol[slot] = firstGap === -1 ? -1 : firstGap - 1;
            } else {
                // Gaps are relative: one write advances this item and everything behind it.
                let at = head + firstGap;
                if (at >= slab) {
                    at -= slab;
                }
                const gap = itemGaps[base + at] - 1;
                itemGaps[base + at] = gap;
                this._bufferItemAt(batches, slot, base + at);
                if (firstGap === 0) {
                    leadGapCol[slot] = gap;
                }
                // Amortized O(1): the walk never revisits an item.
                if (gap === 0) {
                    firstGapCol[slot] = this._nextPositiveGap(slot, firstGap + 1);
                }
            }
            headGapCol[slot] += 1;
        }

        // Phase 2: ingest each path's resting in-port item at the input edge.
        const itemIds = this._items.ids;
        for (let slot = 0; slot < count; slot += 1) {
            const inPort = inPortCol[slot];
            if (headGapCol[slot] === 0 || P[inPort] === EMPTY) {
                continue;
            }
            const type = P[inPort];
            // The item lands on the input edge, carrying the headroom ahead of it.
            const gap = headGapCol[slot] - 1;
            const id = this._nextItemId;
            this._nextItemId += 1;
            const slab = slabCol[slot];
            const items = countCol[slot];
            if (firstGapCol[slot] === -1 && gap > 0) {
                firstGapCol[slot] = items;
            }
            let at = headCol[slot] + items;
            if (at >= slab) {
                at -= slab;
            }
            const cell = baseCol[slot] + at;
            itemIds[cell] = id;
            itemTypes[cell] = type;
            itemGaps[cell] = gap;
            countCol[slot] = items + 1;
            if (items === 0) {
                leadGapCol[slot] = gap;
            }
            this._bufferItemAt(batches, slot, cell);
            headGapCol[slot] = 0;
            engine.setPortItem(inPort, EMPTY);
        }

        // Phase 3: write this tick's pops into their out-ports.
        for (let i = 0; i < popCount; i += 1) {
            engine.setPortItem(this._popPorts[i], this._popTypes[i]);
        }

        for (const batch of batches.values()) {
            engine.emitEvent(batch);
        }
    }

    /**
     * Grows the deferred-pop columns so row `count` is addressable.
     * @private
     * @param {number} count
     * @returns {void}
     */
    _growPops(count) {
        if (count < this._popCapacity) {
            return;
        }
        let capacity = this._popCapacity;
        while (capacity <= count) {
            capacity *= 2;
        }
        for (const name of ["_popPorts", "_popTypes"]) {
            const grown = new Int32Array(capacity);
            grown.set(this[name]);
            this[name] = grown;
        }
        this._popCapacity = capacity;
    }

    /**
     * The events recreating `chunk`'s paths and in-flight items for a just-subscribed session.
     * @param {number} chunk
     * @returns {object[]}
     */
    chunkSync(chunk) {
        const origin = chunkOrigin(chunk);
        let paths = null;
        let items = null;
        const chunkPaths = this._pathsByChunk.get(chunk);
        for (const path of chunkPaths === undefined ? [] : chunkPaths) {
            const head = this._headInfo(path);
            if (paths === null) {
                paths = new BeltPathBatchEvent(origin.x, origin.y);
            }
            paths.add(path.headX, path.headY, [...path.beltIds].reverse(), path.outPort);
            for (const item of this._unloadItems(path.slot)) {
                if (items === null) {
                    items = new BeltItemBatchEvent(head.x, head.y);
                }
                items.addUpsert(head.pathId, item.id, item.gap, item.type);
            }
        }
        // Paths before items: the client positions a path's items against the path.
        return [paths, items].filter(batch => batch !== null);
    }

    /**
     * Serialize hook: flushes the JS path runtime into the snapshot components, clearing prior save entities.
     * @private
     * @returns {void}
     */
    _materialize() {
        for (const def of [this._itemDef, this._beltDef, this._pathDef]) {
            for (const eid of this.engine.entitiesWith(def)) {
                this.engine.destroyEntity(eid);
            }
        }

        const BP = this._pathDef.store;
        const B = this._beltDef.store;
        const I = this._itemDef.store;
        for (const path of this.paths) {
            const pathEid = this.engine.createEntity(this._pathDef);
            BP.inPort[pathEid] = path.inPort;
            BP.outPort[pathEid] = path.outPort;
            BP.headGap[pathEid] = this._colHeadGap[path.slot];
            BP.length[pathEid] = path.length;

            for (const [index, beltId] of path.beltIds.entries()) {
                const memberEid = this.engine.createEntity(this._beltDef);
                B.path[memberEid] = pathEid;
                B.seq[memberEid] = index;
                B.objectId[memberEid] = beltId;
            }

            for (const [seq, item] of this._unloadItems(path.slot).entries()) {
                const itemEid = this.engine.createEntity(this._itemDef);
                I.path[itemEid] = pathEid;
                I.seq[itemEid] = seq;
                I.gap[itemEid] = item.gap;
                I.type[itemEid] = item.type;
                I.itemId[itemEid] = item.id;
            }
        }

        this.engine.globals.beltNextItemId = this._nextItemId;
    }

    /**
     * Clears the belt indexes ahead of a rebuild; belts re-register before the path hook re-links.
     * @returns {void}
     */
    resetBelts() {
        this._belts = new Map();
        this._beltById = new Map();
    }

    /**
     * Re-registers one placed belt after a load.
     * @param {{x:number, y:number, direction:number, type:number, id:number}} belt
     * @returns {void}
     */
    registerBelt(belt) {
        this._addBelt(belt);
    }

    /**
     * Rebuild hook: re-links each path from the snapshot components over the re-registered belts.
     * @private
     * @returns {void}
     */
    _reconstruct() {
        this.paths = [];
        this._slotByInPort.clear();
        this._pathsByTile = new Map();
        this._pathByBeltId = new Map();
        this._pathsByChunk = new Map();
        this._nextItemId = this.engine.globals.beltNextItemId;

        const BP = this._pathDef.store;
        const B = this._beltDef.store;
        const I = this._itemDef.store;

        const beltsByPath = new Map();
        for (const eid of this.engine.entitiesWith(this._beltDef)) {
            const belt = this.beltById(B.objectId[eid]);
            const pathEid = B.path[eid];
            if (!beltsByPath.has(pathEid)) {
                beltsByPath.set(pathEid, []);
            }
            beltsByPath.get(pathEid).push({seq: B.seq[eid], belt});
        }

        const itemsByPath = new Map();
        for (const eid of this.engine.entitiesWith(this._itemDef)) {
            const pathEid = I.path[eid];
            if (!itemsByPath.has(pathEid)) {
                itemsByPath.set(pathEid, []);
            }
            itemsByPath.get(pathEid).push({seq: I.seq[eid], item: {id: I.itemId[eid], type: I.type[eid], gap: I.gap[eid]}});
        }

        for (const pathEid of this.engine.entitiesWith(this._pathDef)) {
            const belts = (beltsByPath.get(pathEid) || []).sort((a, b) => a.seq - b.seq).map(entry => entry.belt);
            const items = (itemsByPath.get(pathEid) || []).sort((a, b) => a.seq - b.seq).map(entry => entry.item);
            const path = {
                id: pathEid,
                belts: belts.map(belt => tileId(belt.x, belt.y)),
                beltIds: belts.map(belt => belt.id),
                headX: belts[0].x,
                headY: belts[0].y,
                tailX: belts[belts.length - 1].x,
                tailY: belts[belts.length - 1].y,
                inPort: BP.inPort[pathEid],
                outPort: BP.outPort[pathEid],
                length: BP.length[pathEid],
                initialHeadGap: BP.headGap[pathEid],
                items,
            };
            this._trackPath(path);
        }
    }


    /**
     * Debug helper: drops an item onto the first belt path's in-port.
     * @returns {void}
     */
    debugInsertItem() {
        if (this.paths.length > 0) {
            this.engine.setPortItem(this.paths[0].inPort, 1);
        }
    }
}
