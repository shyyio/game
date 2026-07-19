import {TickPhase, Direction, EMPTY, NO_EID, chunkId, chunkOrigin, tileId} from "@/sdk/common.js";
import {
    BeltInsertEvent,
    BeltSyncBatchEvent,
    BeltPathBatchEvent,
    BeltDeleteEvent,
    BeltPathRecalculateEvent,
    BeltItemSyncEvent,
    BeltItemResetEvent,
    BeltItemBatchEvent,
} from "./events.js";
import {
    BELT_NORMAL,
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
    LAYERS_UNDERGROUND_AXIS,
} from "./constants.js";
import {beltPositionLayer} from "./geometry.js";
import {ItemStore} from "./ItemStore.js";

// An empty half-tile in a path's occupancy.
const GAP = 0;

// Initial slot count for the per-path hot columns; grows by doubling.
const PATH_CAPACITY = 1024;

// Slot column value for a port that feeds no path.
const NO_SLOT = -1;


// Marks a live path entity. One shared object: the world keys components by identity, so a fresh
// literal per path would register a new component each time and burn a mask bit on every path.
const PATH_MARKER = {};

/**
 * Belt path movement on the bitECS engine, isolated-single-path subset: no merge/split/relink,
 * undergrounds, or cross-path shift chains yet. A path is a run of belts carrying a slab of the
 * shared {@link ItemStore} (ordered output-edge -> input-edge, each item holding the empty half-tiles
 * ahead of it) plus a
 * head_gap of empty half-tiles at the input edge. Each tick the first positive gap shrinks (Case 1)
 * or the lead item pops to the out-port (Case 2), growing head_gap, then a resting in-port item is
 * ingested at the input edge — all in constant time whatever the path carries.
 */
export class Belts {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        this.engine = engine;
        // Path records keyed by head eid: {inPort, outPort, length, headGap, items}. `items` holds the
        // path's item list only while it is not live: as a seed before it is tracked, and as a
        // snapshot after it is dropped (an edit still reads what a replaced path carried). A live
        // path's items sit in the shared store, addressed by its slot's columns.
        this.paths = [];
        // Port eid -> the slot of the path fed by it, so a path finds its downstream neighbor across a
        // shared seam port. A column rather than a Map: the submit pass reads it once per path per tick.
        this._slotByInPort = this.engine.registerPortColumn(NO_SLOT);
        // Tile key -> paths covering it, and belt id -> its one path. Edits touch only the tiles/belts
        // of the run they rebuild, so these keep placement off a scan of every path in the world.
        this._pathsByTile = new Map();
        this._pathByBeltId = new Map();
        // Hot per-path state as typed columns indexed by slot (a path record carries its own slot, so
        // dropping one is a swap-pop instead of a rebuild of the array). The tick phases read only these, so a
        // pass over every path stays in sequential memory instead of chasing a path object and its
        // ring. `_colLeadGap` is the lead item's gap (-1 when the path is empty) and `_colFirstGap`
        // the index of the first item with room ahead of it; both are updated in place as the tick
        // mutates the ring, so no phase rescans it.
        this._pathCapacity = PATH_CAPACITY;
        this._colInPort = new Int32Array(PATH_CAPACITY);
        this._colOutPort = new Int32Array(PATH_CAPACITY);
        this._colHeadGap = new Int32Array(PATH_CAPACITY);
        this._colCount = new Int32Array(PATH_CAPACITY);
        this._colLeadGap = new Int32Array(PATH_CAPACITY);
        this._colFirstGap = new Int32Array(PATH_CAPACITY);
        // Whether the path's chunk has a watcher, and the observation generation that answer was
        // computed at (0 = never). Asking the engine costs a chunk hash and a call through the
        // subscription predicate, which the move loop would otherwise pay per moving path per tick.
        this._colObserved = new Uint8Array(PATH_CAPACITY);
        this._colObservedGen = new Int32Array(PATH_CAPACITY);
        // The path's slab in the shared item store: where it starts, how many slots it spans, and
        // which slot currently holds the lead (output-edge) item.
        this._colItemBase = new Int32Array(PATH_CAPACITY);
        this._colItemSlab = new Int32Array(PATH_CAPACITY);
        this._colItemHead = new Int32Array(PATH_CAPACITY);
        // Out-port writes _move defers to its last phase, reused tick to tick.
        this._popCapacity = PATH_CAPACITY;
        this._popPorts = new Int32Array(PATH_CAPACITY);
        this._popTypes = new Int32Array(PATH_CAPACITY);
        // Placed belts by tile key -> belt[] {x, y, direction, type, id}. A tile can hold several belts
        // on different axes/layers (a surface belt and an underground crossing under it); the run at a
        // tile is disambiguated by direction.
        this._belts = new Map();
        // Belt id -> belt, an index over the tile map for O(1) lookup by client id.
        this._beltById = new Map();
        // Chunk -> the belts and the paths (by head tile) it holds, so a subscribing session syncs a
        // chunk without a scan of every belt and path in the world. Paths never cross a chunk seam.
        this._beltsByChunk = new Map();
        this._pathsByChunk = new Map();
        // Every live path's items, in three shared columns.
        this._items = new ItemStore();
        // Stable item id, the client's sprite key for continuity/glide.
        this._nextItemId = 1;

        // Belt runtime state lives in the JS maps above (hot-path); for persistence it is materialized
        // into these registered components at save (via the serialize hook) and read back at load (via
        // the rebuild hook), so belts ride the same generic snapshot as every other object. Port
        // references are eid columns, remapped with the shared Port entities on load.
        // Belt state lives in JS runtime; these three components mirror it only at save (materialize)
        // and load (reconstruct), so they are snapshotOnly — the port sweep reads the live pin hook.
        this._pathDef = engine.defineComponent("BeltPath", [
            {name: "inPort", kind: "eid", fill: NO_EID},
            {name: "outPort", kind: "eid", fill: NO_EID},
            {name: "headGap"},
            {name: "length"},
        ], {snapshotOnly: true});
        this._beltDef = engine.defineComponent("Belt", [
            {name: "path", kind: "eid", fill: NO_EID},
            {name: "index"},
            {name: "x"},
            {name: "y"},
            {name: "direction"},
            {name: "type"},
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
     * The belt on tile (x, y) facing `direction`, or undefined. At most one exists (same-axis overlap
     * is disallowed).
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
     * The surface (non-underground) belt on tile (x, y), or undefined.
     * @private
     * @param {number} x
     * @param {number} y
     * @returns {object|undefined}
     */
    _surfaceBeltAt(x, y) {
        return this._beltsAt(x, y).find(belt => belt.type !== BELT_UNDERGROUND);
    }

    /**
     * The belt `belt` flows into: the belt on the tile ahead that continues the flow. A surface belt
     * flows into the surface belt ahead (any facing — a bend); an underground continues the buried run
     * on its own axis (another underground or a ramp).
     * @private
     * @param {object} belt
     * @returns {object|undefined}
     */
    _flowInto(belt) {
        const ax = belt.x + Direction.dx(belt.direction);
        const ay = belt.y + Direction.dy(belt.direction);
        const ahead = this._beltsAt(ax, ay);
        // An underground or a ramp-down feeds a buried output: the tunnel continues on the same axis
        // into another underground or the ramp-up exit. Everything else feeds a surface belt.
        if (belt.type === BELT_UNDERGROUND || belt.type === BELT_RAMP_DOWN) {
            return ahead.find(candidate =>
                (candidate.type === BELT_UNDERGROUND || candidate.type === BELT_RAMP_UP)
                && Direction.axis(candidate.direction) === Direction.axis(belt.direction));
        }
        return ahead.find(candidate => candidate.type !== BELT_UNDERGROUND);
    }

    /**
     * The belt feeding `belt` on its path: of the belts flowing into its tile, the most recently placed
     * (highest id) wins the slot, so a newly placed belt steals a junction from an older feeder.
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
        this._chunkAdd(this._beltsByChunk, chunkId(belt.x, belt.y), belt);
    }

    /**
     * Adds a member to a chunk-keyed set index.
     * @private
     * @param {Map<number, Set>} index
     * @param {number} chunk
     * @param {object} member
     * @returns {void}
     */
    _chunkAdd(index, chunk, member) {
        const held = index.get(chunk);
        if (held === undefined) {
            index.set(chunk, new Set([member]));
        } else {
            held.add(member);
        }
    }

    /**
     * Drops a member from a chunk-keyed set index, dropping the chunk once it empties.
     * @private
     * @param {Map<number, Set>} index
     * @param {number} chunk
     * @param {object} member
     * @returns {void}
     */
    _chunkRemove(index, chunk, member) {
        const held = index.get(chunk);
        if (held === undefined) {
            return;
        }
        held.delete(member);
        if (held.size === 0) {
            index.delete(chunk);
        }
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
        this._chunkRemove(this._beltsByChunk, chunkId(belt.x, belt.y), belt);
    }

    /**
     * @returns {number}
     */
    get beltCount() {
        return this._beltById.size;
    }

    /**
     * Places a straight normal belt at (x, y) facing `direction`, (re)building the maximal in-line run
     * it belongs to into one empty path. Path-construction subset: straight connections only, and
     * built empty (no in-flight-item stash/unstash across merges yet).
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {{id:number, inPort:number, outPort:number, length:number}}
     */
    placeBelt(x, y, direction, type=BELT_NORMAL) {
        // Surface belts (normal/ramp) share the surface layer; an underground occupies its axis layer,
        // so it can cross under a surface belt. Reject if the layer's cell is taken.
        const layer = beltPositionLayer(type, direction);
        if (!this.engine.cellsFree([{x, y, layer}])) {
            return null;
        }
        const placed = {x, y, direction, type, id: this.engine.createObjectId()};
        this.engine.occupy([{x, y, layer}], placed.id);

        this._addBelt(placed);

        // The run through the placed belt, following the flow across bends. Dropping the paths it
        // overlaps can orphan belts that were in one of those paths but not in this run (a junction the
        // new belt stole the downstream from) — each orphan rebuilds into its own path.
        const run = this._collectRun(placed);
        const {removed, orphans} = this._removePathsOverlapping(run);
        const result = this._buildRun(run, placed, removed);
        const rebuilt = this._rebuildOrphans(orphans, run, removed);

        this.engine.emitEvent(new BeltInsertEvent(x, y, placed.id, direction, placed.type));
        // Recalc + item rows for every path that changed (the run and any split-off orphan), so the
        // client re-links geometry and positions items against the rebuilt paths.
        const affected = [...run, ...rebuilt].map(belt => tileId(belt.x, belt.y));
        this._emitPathRecalcs(affected);
        this._emitPathItems(affected);
        return result;
    }

    /**
     * Builds the run into paths: one path if it stays in a chunk (preserving in-flight items on an end
     * extension), else one seam-connected empty path per chunk (paths never cross a chunk border).
     * @private
     * @param {object[]} run - the run's belts, head -> tail
     * @param {object} placed - the belt just placed
     * @param {object[]} [removed] - the paths just dropped, for end-extension item preservation
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
     * Rebuilds each orphaned belt (left pathless by a stolen junction) into its own path, carrying the
     * items that sat on its belts in the source path, and skipping any already covered by the run or an
     * earlier orphan's rebuild.
     * @private
     * @param {object[]} orphans - belts dropped from removed paths, not in the run
     * @param {object[]} run - the run's belts (already rebuilt)
     * @param {object[]} removed - the source paths the orphans were dropped from
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
     * Rebuilds a sub-run split off by an edit into its own path: a single-chunk sub-run keeps the items
     * that sat on its belts in whichever source path fully contains it (empty if none does); a run
     * spanning chunk borders rebuilds empty per-chunk (cross-chunk item preservation deferred).
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
     * Emits a path-recalc event for every path covering one of `tileKeys`, so the client re-links its
     * belt geometry.
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
     * Re-emits the item rows of every path covering one of `tileKeys`, after the belt-insert +
     * path-recalc so the client positions them against the rebuilt path.
     * @private
     * @param {number[]} tileKeys
     * @returns {void}
     */
    _emitPathItems(tileKeys) {
        for (const path of this._pathsCovering(tileKeys)) {
            // Re-sync (snap), not upsert (glide): the edit re-rowed the items but didn't move them.
            for (const item of this._unloadItems(path.slot)) {
                const event = this._itemSyncEvent(path, item.id, item.gap, item.type);
                if (event !== null) {
                    this.engine.emitEvent(event);
                }
            }
        }
    }

    /**
     * The path-recalc event for a path: its belt ids in path order (head last) and its out-port id,
     * routed by the head tile.
     * @private
     * @param {object} path
     * @returns {BeltPathRecalculateEvent}
     */
    _pathRecalcEvent(path) {
        const parts = [...path.beltIds].reverse();
        return new BeltPathRecalculateEvent(path.headX, path.headY, parts, path.outPort);
    }

    /**
     * The client path id (head belt id) and head tile, or null for a synthetic path without belts
     * (test-only addPath), which emits no client events.
     * @private
     * @param {object} path
     * @returns {{pathId: number, x: number, y: number}|null}
     */
    _headInfo(path) {
        if (path.belts === undefined) {
            return null;
        }
        return {
            pathId: path.beltIds[0],
            x: path.headX,
            y: path.headY,
        };
    }

    /**
     * Buffers the upsert for the item in store cell `cell`, carried by the path in `slot`. Takes the
     * cell rather than the item's fields so an unobserved path reads none of them.
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
        if (head === null) {
            return;
        }
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
     * Whether the path in `slot` has a watcher, cached until the engine's observation generation moves.
     * The move loop checks this before building per-item events; a session subscribing later gets the
     * path through chunkSync.
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
     * The re-sync for one of a path's items: a snap in place, since an edit re-rowed the item
     * without moving it.
     * @private
     * @param {object} path
     * @param {number} itemId
     * @param {number} gap
     * @param {number} type
     * @returns {BeltItemSyncEvent|null}
     */
    _itemSyncEvent(path, itemId, gap, type) {
        const head = this._headInfo(path);
        if (head === null) {
            return null;
        }
        return new BeltItemSyncEvent(head.x, head.y, head.pathId, itemId, gap, type);
    }

    /**
     * Buffers the delete for the lead item a path is about to pop. Takes the store cell rather than
     * the id so an unobserved path reads nothing.
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
        if (head === null) {
            return;
        }
        this._itemBatch(batches, head).addDelete(head.pathId, this._items.ids[cell]);
    }

    /**
     * @private
     * @param {object} path
     * @returns {void}
     */
    _emitItemReset(path) {
        const head = this._headInfo(path);
        if (head === null) {
            return;
        }
        this.engine.emitEvent(new BeltItemResetEvent(head.x, head.y, head.pathId));
    }

    /**
     * Removes the belt at (x, y) facing `direction`, rebuilding the surviving runs on each side (the
     * path splits, or shortens). Rebuilt empty for now — in-flight-item preservation across deletion
     * is deferred.
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

        // The belts this one linked to — the belt ahead and every belt that fed its tile — anchor the
        // surviving runs. Captured before removal, while the flow links are intact.
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

        // Capture the paths holding this belt (with their item layout) before dropping them, so each
        // surviving sub-run keeps the items that were physically on its belts.
        const held = this._pathByBeltId.get(removedId);
        const source = held === undefined ? [] : [held];
        if (held !== undefined) {
            this._forgetPath(held);
        }
        this._removeBeltObject(belt);

        // Rebuild each surviving neighbor's run into its own path (split or shortened), carrying the
        // items that sat on its belts in the removed path.
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

        this.engine.emitEvent(new BeltDeleteEvent(x, y, removedId));
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
     * The undergrounds buried in `ramp`'s tunnel (not the paired ramp): walking the buried run from a
     * ramp-down downstream, or from a ramp-up upstream, while the belts are undergrounds.
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
     * The path's per-half-tile occupancy, indexed from the input (head) edge: `headGap` empty
     * (GAP) cells, then the items filled toward the output edge.
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
     * Rebuilds `{items, headGap}` from a per-half-tile occupancy slice (indexed from the input edge):
     * walking in from the output edge, each occupied cell becomes an item carrying the empty cells
     * just passed, and whatever empties trail at the input edge are the head-gap.
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
     * The items for a run that merges several removed paths (folding them into one): each belt keeps
     * its own half-tile content, the newly placed belt is empty, and a resting port item that a merge
     * buries (a source's out-port, or a sink's in-port) re-enters at that internal boundary.
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
                // Each belt's output half carries its content; a belt that had an input half (non-head in
                // the source) keeps it too when it still has one in the merged run.
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
     * The items to carry onto a sub-run split off `sourcePath` by a deletion: the occupancy of the
     * sub-run's belts in the source path, re-derived. Empty unless the sub-run is a contiguous slice of
     * the source (a merge into another path can't map its slots).
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
     * A new path record over `runBelts` (head -> tail) with the given items/head-gap. The head belt id
     * is the client path id; the tail's downstream edge is the out-port.
     * @private
     * @param {object[]} runBelts
     * @param {{items:{id:number, type:number, gap:number}[], headGap?:number}} state
     * @returns {object}
     */
    _makePath(runBelts, {items, headGap}) {
        const ports = this._pathPorts(runBelts);
        let inPort = ports.inPort;
        const outPort = ports.outPort;
        // A closed loop (the tail flows back into the head) shares one port for both ends, so the popped
        // lead item re-ingests and items circulate instead of piling at a dead out-port.
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
     * Builds a per-chunk chain of empty seam-connected paths (each segment's out-port is the next
     * segment's in-port). Returns the whole chain's endpoints and segment path ids.
     * @private
     * @param {object[][]} segments - the run's belts split into per-chunk segments, head -> tail
     * @returns {{id:number, inPort:number, outPort:number, segments:number[]}}
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
            segments: built.map(path => path.id),
        };
    }

    /**
     * The shared in/out ports for a run (belts head -> tail): the in-port is the edge feeding the head
     * tile (head belt's facing); the out-port is the edge the tail feeds downstream (tail belt's
     * facing) — so seams and adjacent objects adopt the same ports via {@link GameEngine#portAt}.
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
     * Builds the single-chunk run through the placed belt into one path, preserving in-flight items
     * when it end-extends one just-removed path.
     * @private
     * @param {object[]} run - the run's belts, head -> tail
     * @param {object} placed - the belt just placed
     * @param {object[]} removed - the paths just dropped by this placement
     * @returns {{id:number, inPort:number, outPort:number, length:number, segments:number[]}}
     */
    _buildSingleChunk(run, placed, removed) {
        const runKeys = run.map(belt => tileId(belt.x, belt.y));
        const newKey = tileId(placed.x, placed.y);

        // Extending one existing path at an end preserves its in-flight items; anything else (a fresh
        // isolated belt, a junction split, or a merge of two item-carrying paths) rebuilds empty.
        let items = [];
        let headGap = run.length * 2 - 1;
        const extension = removed.length === 1 && this._isEndExtension(runKeys, removed[0].belts, newKey)
            ? removed[0]
            : null;
        if (extension !== null) {
            const old = extension;
            if (runKeys[0] === newKey) {
                // Head (input-edge) extension: the new empty belt is head room; items keep their
                // distance from the unchanged output edge (item ids are reassigned below).
                items = old.items;
                headGap = old.initialHeadGap + 2;
            } else {
                // Tail (output-edge) extension: the new belt is empty space at the moved-forward output
                // edge. In-flight items keep their distance from the input edge; a resting out-port item
                // re-enters at the new belt's input edge and crosses it before reaching the new out-port.
                const carried = old.items;
                const resting = this.engine.Port.item[old.outPort];
                if (resting !== EMPTY) {
                    // The out-port item sat at the tail's output edge, so after the extension it rests at
                    // the new belt's input edge — one half-tile from the moved out-port. It leads the
                    // path with that half-tile ahead of it, keeping its visual position.
                    items = [{id: this._nextItemId, type: resting, gap: 1}, ...carried];
                    this._nextItemId += 1;
                    headGap = old.initialHeadGap;
                    this.engine.setPortItem(old.outPort, EMPTY);
                } else if (carried.length === 0) {
                    // Empty path: all the new space is head room.
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
            // A merge (or junction split) that folds one or more item-carrying paths into this run:
            // reconstruct the items from each belt's half-tile content.
            ({items, headGap} = this._mergedItems(run, removed));
        }

        // The client orders items by id (ascending = output -> input), so renumber the rebuilt run in
        // array order to keep that invariant — a prepended lead item would otherwise sort as input-most
        // and shift the items a tile toward the output. Safe because the edit re-syncs (RESET + snap),
        // so the old sprite ids need not be kept.
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
     * @param {string[]} runKeys - the run ordered head -> tail
     * @param {string[]} oldBelts
     * @param {string} newKey
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
     * The path run through `belt`, ordered head (most upstream, in-port) -> tail (most downstream,
     * out-port), following the flow across bends. Each step links only when the downstream belt's
     * chosen upstream is this one, so a junction ends the run there (the other branch is its own path).
     * @private
     * @param {object} belt
     * @returns {object[]} the run's belts, head -> tail
     */
    _collectRun(belt) {
        // Walk upstream to the head, stopping at a loop or a belt whose chosen upstream diverges.
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

        // Collect downstream from the head, stopping where the flow leaves a belt this run owns.
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
     * Drops any path sharing a belt with `run` (matched by belt id, so a crossing perpendicular path —
     * a different belt on the same tile — survives). Returns the dropped paths and the belts they held
     * that the run doesn't (orphaned by a stolen junction, to be rebuilt into their own paths).
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
     * The port eids the live paths still reference (each path's in/out edge port), so the engine's
     * port sweep keeps them — belt paths hold these outside any component.
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
     * Moves a new path's seed items into the shared store: a slab as wide as the path (it can never
     * hold more items than it has half-tiles), filled output edge -> input edge, then the derived lead
     * columns. The record's list is dropped — from here the slot's columns own the items.
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
     * The index of the first item at or after `from` with empty space ahead of it, or -1. This is the
     * gap a stalled path compresses into; it only ever walks forward, so the scan is amortized O(1).
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
     * Recomputes a path's lead columns by scanning its slab. Only for a path whose items were set
     * wholesale (build, load, edit); the tick phases update the columns in place instead.
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
        // Snapshot the live head-gap and items back onto the record: a dropped path is still read by
        // the edit that replaced it (an end extension carries its head room and load forward).
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
     * Adds a path to the tile and belt-id indexes. A synthetic path without belts (test-only addPath)
     * indexes nothing.
     * @private
     * @param {object} path
     * @returns {void}
     */
    _indexPath(path) {
        if (path.belts === undefined) {
            return;
        }
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
        this._chunkAdd(this._pathsByChunk, chunkId(path.headX, path.headY), path);
    }

    /**
     * @private
     * @param {object} path
     * @returns {void}
     */
    _unindexPath(path) {
        if (path.belts === undefined) {
            return;
        }
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
        this._chunkRemove(this._pathsByChunk, chunkId(path.headX, path.headY), path);
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
        // Clear the client's item sprites for this (soon-stale) path id.
        this._emitItemReset(path);
        this.engine.destroyEntity(path.id);
    }

    /**
     * Creates an empty straight path of `beltCount` belts. Its out-port is fresh; its in-port is
     * `inPort` when given (a shared seam with an upstream path's out-port) else a fresh input port.
     * @param {number} beltCount
     * @param {number} [inPort] - existing port to reuse as the in-port (seam)
     * @returns {{id:number, inPort:number, outPort:number, length:number}}
     */
    addPath(beltCount, inPort) {
        const resolvedInPort = inPort === undefined ? this.engine.createPort() : inPort;
        const outPort = this.engine.createPort();
        const length = beltCount * 2 - 1;

        const eid = this.engine.world.addEntity();
        this.engine.world.addComponent(eid, PATH_MARKER);
        // Belt-less, so it carries no tiles: the fields the tile/render paths read stay undefined.
        const path = {
            id: eid,
            belts: undefined,
            beltIds: undefined,
            headX: undefined,
            headY: undefined,
            tailX: undefined,
            tailY: undefined,
            inPort: resolvedInPort,
            outPort,
            length,
            initialHeadGap: length,
            items: [],
        };
        this._pushPath(path);
        this._slotByInPort.column[resolvedInPort] = path.slot;

        return {id: eid, inPort: resolvedInPort, outPort, length};
    }

    /**
     * SUBMIT_INTENTS: a path with an item resting on its output edge submits the virtual shift intent
     * (in-port -> out-port, managed=0) so the resolver frees the out-port; a path with head room or a
     * gap declares its in-port drainable (destination-less) so an upstream transfer can resolve.
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
                // The out-port is free if empty, or if the downstream path can ingest this tick (head
                // room or a gap), letting the resolver's chain shift the whole packed run at once.
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
     * POST_RESOLVE: move each path one half-tile (pop the lead item, or shrink the first gap with room
     * in it), grow head_gap accordingly, then ingest a resting in-port item at the input edge.
     * @private
     * @returns {void}
     */
    _move() {
        const P = this.engine.Port.item;

        // Phase 1: move each path one half-tile, buffering pops. Out-port writes are deferred so a
        // shared seam still holds last tick's value when the downstream ingests below (an item rests a
        // tick in the seam).
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
        // Reused across ticks: the deferred out-port writes, as parallel columns.
        let popCount = 0;
        // One batch per chunk, flushed at the end of the pass so the pass stays ordered against
        // everything emitted outside it.
        const batches = new Map();

        for (let slot = 0; slot < count; slot += 1) {
            const firstGap = firstGapCol[slot];
            const canPop = leadGapCol[slot] === 0 && engine.resolvedUnmanagedDest(outPortCol[slot]);
            if (!canPop && firstGap === -1) {
                continue;
            }

            // Only a moving path reaches into the item store; nothing here touches the path record.
            const base = baseCol[slot];
            const slab = slabCol[slot];
            const head = headCol[slot];
            if (canPop) {
                this._growPops(popCount);
                this._popPorts[popCount] = outPortCol[slot];
                this._popTypes[popCount] = itemTypes[base + head];
                popCount += 1;
                this._bufferPoppedItem(batches, slot, base + head);
                // Gaps are distances to the item ahead, so dropping the lead advances the rest and
                // the new lead's gap is already its distance to the output edge.
                const nextHead = head + 1 === slab ? 0 : head + 1;
                const remaining = countCol[slot] - 1;
                headCol[slot] = nextHead;
                countCol[slot] = remaining;
                leadGapCol[slot] = remaining === 0 ? -1 : itemGaps[base + nextHead];
                firstGapCol[slot] = firstGap === -1 ? -1 : firstGap - 1;
            } else {
                // One write advances the item holding this gap and everything behind it; the packed
                // block ahead stays put.
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
                // A closed gap stays closed until the block ahead pops, so this walk never revisits
                // an item: amortized constant.
                if (gap === 0) {
                    firstGapCol[slot] = this._nextPositiveGap(slot, firstGap + 1);
                }
            }
            headGapCol[slot] += 1;
        }

        // Phase 2: ingest each path's resting in-port item at the input edge, filling the head room.
        const itemIds = this._items.ids;
        for (let slot = 0; slot < count; slot += 1) {
            const inPort = inPortCol[slot];
            if (headGapCol[slot] === 0 || P[inPort] === EMPTY) {
                continue;
            }
            const type = P[inPort];
            // The ingested item lands on the input edge, so it carries the head room ahead of it.
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
     * The events recreating this module's belts and their in-flight items in `chunk`, for a session
     * that just subscribed: one belt-sync event per belt tile, then per path a recalc plus one upsert
     * per in-flight item. Resting out-port items ride the engine's shared rendered-port sync.
     * @param {number} chunk
     * @returns {object[]}
     */
    chunkSync(chunk) {
        const origin = chunkOrigin(chunk);
        let belts = null;
        const chunkBelts = this._beltsByChunk.get(chunk);
        if (chunkBelts !== undefined) {
            belts = new BeltSyncBatchEvent(origin.x, origin.y);
            for (const belt of chunkBelts) {
                belts.add(belt.id, belt.x, belt.y, belt.direction, belt.type);
            }
        }
        let paths = null;
        let items = null;
        const chunkPaths = this._pathsByChunk.get(chunk);
        for (const path of chunkPaths === undefined ? [] : chunkPaths) {
            const head = this._headInfo(path);
            if (head === null) {
                continue;
            }
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
        // Belts before paths before items: the client positions a path against its belts, and its
        // items against the path.
        return [belts, paths, items].filter(batch => batch !== null);
    }

    /**
     * Serialize hook: flushes the JS runtime (paths, belts, items) into the BeltPath/Belt/BeltItem
     * components so the generic snapshot captures belts. Prior save entities are cleared first; the
     * shared Port entities carry the port items, referenced here by eid.
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
            // Synthetic belt-less paths (test-only addPath) have no belt tiles to model; skip them.
            if (path.beltIds === undefined) {
                continue;
            }
            const pathEid = this.engine.createEntity(this._pathDef);
            BP.inPort[pathEid] = path.inPort;
            BP.outPort[pathEid] = path.outPort;
            BP.headGap[pathEid] = this._colHeadGap[path.slot];
            BP.length[pathEid] = path.length;

            for (const [index, beltId] of path.beltIds.entries()) {
                const belt = this.beltById(beltId);
                const beltEid = this.engine.createEntity(this._beltDef);
                B.path[beltEid] = pathEid;
                B.index[beltEid] = index;
                B.x[beltEid] = belt.x;
                B.y[beltEid] = belt.y;
                B.direction[beltEid] = belt.direction;
                B.type[beltEid] = belt.type;
                B.objectId[beltEid] = beltId;
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
     * Rebuild hook: reconstructs the JS runtime from the BeltPath/Belt/BeltItem components a load
     * repopulated, re-linking each path's belts, items, and ports and re-registering its rendered
     * out-port.
     * @private
     * @returns {void}
     */
    _reconstruct() {
        this.paths = [];
        this._slotByInPort.clear();
        this._pathsByTile = new Map();
        this._pathByBeltId = new Map();
        this._belts = new Map();
        this._beltById = new Map();
        this._beltsByChunk = new Map();
        this._pathsByChunk = new Map();
        this._nextItemId = this.engine.globals.beltNextItemId;

        const BP = this._pathDef.store;
        const B = this._beltDef.store;
        const I = this._itemDef.store;

        const beltsByPath = new Map();
        for (const eid of this.engine.entitiesWith(this._beltDef)) {
            const belt = {x: B.x[eid], y: B.y[eid], direction: B.direction[eid], type: B.type[eid], id: B.objectId[eid]};
            this._addBelt(belt);
            const pathEid = B.path[eid];
            if (!beltsByPath.has(pathEid)) {
                beltsByPath.set(pathEid, []);
            }
            beltsByPath.get(pathEid).push({index: B.index[eid], belt});
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
            const belts = (beltsByPath.get(pathEid) || []).sort((a, b) => a.index - b.index).map(entry => entry.belt);
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
