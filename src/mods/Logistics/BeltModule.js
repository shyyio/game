import {addEntity, addComponent} from "bitecs";
import {TickPhase, Direction} from "@/sdk/common.js";
import {chunkId} from "@/common/util.js";
import {EMPTY, NO_EID} from "@/common/sim/EcsEngine.js";
// Layering debt: the ECS content modules live in common/sim/ but emit mod-owned belt events. They
// belong in mods/Logistics/ (see project_bitecs_migration memory); this import crosses the layer for now.
import {
    BeltInsertEvent,
    BeltSyncEvent,
    BeltDeleteEvent,
    BeltPathRecalculateEvent,
    BeltItemUpsertEvent,
    BeltItemSyncEvent,
    BeltItemDeleteEvent,
    BeltItemResetEvent,
} from "./events.js";
import {
    BELT_NORMAL,
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    BELT_UNDERGROUND,
} from "./constants.js";

// A gap run in a path's RLE item list (empty half-tiles between items).
const GAP = 0;

// Tile key for the belt registry.
function tileKey(x, y) {
    return `${x},${y}`;
}

/**
 * Belt path movement on the bitECS engine, isolated-single-path subset: no merge/split/relink,
 * undergrounds, or cross-path shift chains yet. A path is a run of belts carrying RLE item rows
 * (ordered output-edge -> input-edge) plus a head_gap of empty half-tiles at the input edge. Each
 * tick the lead output-side gap shrinks (Case 1) or the lead item pops to the out-port (Case 2),
 * growing head_gap, then a resting in-port item is ingested at the input edge.
 *
 * Items are per-path arrays for now; the typed-array/SoA layout is a later optimization.
 */
export class BeltModule {

    /**
     * @param {EcsEngine} engine
     */
    constructor(engine) {
        this.engine = engine;
        // Path records keyed by head eid: {inPort, outPort, length, headGap, items:[{length,type}]}.
        this.paths = [];
        // In-port -> path, so a path can find its downstream neighbor across a shared seam port.
        this._byInPort = new Map();
        // Placed belts by tile key -> belt[] {x, y, direction, type, id}. A tile can hold several belts
        // on different axes/layers (a surface belt and an underground crossing under it); the run at a
        // tile is disambiguated by direction.
        this._belts = new Map();
        // Stable RLE run id, the client's item runId for sprite continuity/glide.
        this._nextRunId = 1;

        // Belt runtime state lives in the JS maps above (hot-path); for persistence it is materialized
        // into these registered components at save (via the serialize hook) and read back at load (via
        // the rebuild hook), so belts ride the same generic snapshot as every other object. Port
        // references are eid columns, remapped with the shared Port entities on load.
        this._pathDef = engine.defineComponent("BeltPath", [
            {name: "inPort", kind: "eid", fill: NO_EID},
            {name: "outPort", kind: "eid", fill: NO_EID},
            {name: "headGap"},
            {name: "length"},
        ]);
        this._beltDef = engine.defineComponent("Belt", [
            {name: "path", kind: "eid", fill: NO_EID},
            {name: "index"},
            {name: "x"},
            {name: "y"},
            {name: "direction"},
            {name: "type"},
            {name: "objectId", fill: NO_EID},
        ]);
        this._runDef = engine.defineComponent("BeltRun", [
            {name: "path", kind: "eid", fill: NO_EID},
            {name: "seq"},
            {name: "length"},
            {name: "type"},
            {name: "runId", fill: NO_EID},
        ]);
        engine.globals.beltNextRunId = this._nextRunId;

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._move());
        engine.registerSerializeHook(() => this._materialize());
        engine.registerRebuildHook(() => this._reconstruct());
    }

    /**
     * @private
     * @param {number} x
     * @param {number} y
     * @returns {object[]} the belts on tile (x, y)
     */
    _beltsAt(x, y) {
        const belts = this._belts.get(tileKey(x, y));
        return belts === undefined ? [] : belts;
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
        [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT].forEach(direction => {
            const fx = belt.x - Direction.dx(direction);
            const fy = belt.y - Direction.dy(direction);
            this._beltsAt(fx, fy).forEach(feeder => {
                if (this._flowInto(feeder) === belt && (chosen === undefined || feeder.id > chosen.id)) {
                    chosen = feeder;
                }
            });
        });
        return chosen;
    }

    /**
     * @private
     * @param {object} belt
     * @returns {void}
     */
    _addBelt(belt) {
        const key = tileKey(belt.x, belt.y);
        const belts = this._belts.get(key);
        if (belts === undefined) {
            this._belts.set(key, [belt]);
        } else {
            belts.push(belt);
        }
    }

    /**
     * The occupancy layer for a belt: surface for normal/ramp, the underground axis for undergrounds.
     * @private
     * @param {number} direction
     * @param {number} type
     * @returns {string}
     */
    _beltLayer(direction, type) {
        return type === BELT_UNDERGROUND ? `U${direction % 2}` : "S";
    }

    /**
     * @private
     * @param {object} belt
     * @returns {void}
     */
    _removeBeltObject(belt) {
        const key = tileKey(belt.x, belt.y);
        const remaining = this._beltsAt(belt.x, belt.y).filter(candidate => candidate !== belt);
        if (remaining.length === 0) {
            this._belts.delete(key);
        } else {
            this._belts.set(key, remaining);
        }
    }

    /**
     * Every placed belt across all tiles.
     * @private
     * @returns {object[]}
     */
    _allBelts() {
        const all = [];
        this._belts.forEach(belts => belts.forEach(belt => all.push(belt)));
        return all;
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
        const layer = this._beltLayer(direction, type);
        if (!this.engine.occupancyFree([{x, y, layer}])) {
            return null;
        }
        this.engine.occupy([{x, y, layer}]);

        const placed = {x, y, direction, type, id: this.engine.allocateObjectId()};
        this._addBelt(placed);

        // The run through the placed belt, following the flow across bends. Dropping the paths it
        // overlaps can orphan belts that were in one of those paths but not in this run (a junction the
        // new belt stole the downstream from) — each orphan rebuilds into its own path.
        const run = this._collectRun(placed);
        const {removed, orphans} = this._removePathsOverlapping(run);
        const result = this._buildRun(run, placed, removed);
        const rebuilt = this._rebuildOrphans(orphans, run);

        this.engine.emitEvent(new BeltInsertEvent(x, y, placed.id, direction, placed.type));
        // Recalc + item rows for every path that changed (the run and any split-off orphan), so the
        // client re-links geometry and positions items against the rebuilt paths.
        const affected = [...run, ...rebuilt].map(belt => tileKey(belt.x, belt.y));
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
     * Rebuilds each orphaned belt (left pathless by a stolen junction) into its own path, skipping any
     * already covered by the run or an earlier orphan's rebuild.
     * @private
     * @param {object[]} orphans - belts dropped from removed paths, not in the run
     * @param {object[]} run - the run's belts (already rebuilt)
     * @returns {object[]} the belts of the rebuilt orphan paths
     */
    _rebuildOrphans(orphans, run) {
        const covered = new Set(run.map(belt => belt.id));
        const rebuilt = [];
        orphans.forEach(orphan => {
            if (covered.has(orphan.id)) {
                return;
            }
            const orphanRun = this._collectRun(orphan);
            this._buildRun(orphanRun, orphan);
            orphanRun.forEach(belt => {
                covered.add(belt.id);
                rebuilt.push(belt);
            });
        });
        return rebuilt;
    }

    /**
     * Emits a path-recalc event for every path covering one of `tileKeys`, so the client re-links its
     * belt geometry.
     * @private
     * @param {string[]} tileKeys
     * @returns {void}
     */
    _emitPathRecalcs(tileKeys) {
        const keys = new Set(tileKeys);
        this.paths.forEach(path => {
            if (path.belts.some(key => keys.has(key))) {
                this.engine.emitEvent(this._pathRecalcEvent(path));
            }
        });
    }

    /**
     * Re-emits the item rows of every path covering one of `tileKeys`, after the belt-insert +
     * path-recalc so the client positions them against the rebuilt path.
     * @private
     * @param {string[]} tileKeys
     * @returns {void}
     */
    _emitPathItems(tileKeys) {
        const keys = new Set(tileKeys);
        this.paths.forEach(path => {
            if (path.belts.some(key => keys.has(key))) {
                // Re-sync (snap), not upsert (glide): the edit re-rowed the items but didn't move them.
                path.items.forEach(item => {
                    const event = this._itemUpsertEvent(path, item, true);
                    if (event !== null) {
                        this.engine.emitEvent(event);
                    }
                });
            }
        });
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
        const [headX, headY] = path.belts[0].split(",").map(Number);
        return new BeltPathRecalculateEvent(headX, headY, parts, path.outPort);
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
        const [x, y] = path.belts[0].split(",").map(Number);
        return {
            pathId: path.beltIds[0],
            x: x,
            y: y,
        };
    }

    /**
     * @private
     * @param {object} path
     * @param {{id:number, length:number, type:number}} run
     * @returns {void}
     */
    _emitItemUpsert(path, run) {
        const event = this._itemUpsertEvent(path, run);
        if (event !== null) {
            this.engine.emitEvent(event);
        }
    }

    /**
     * @private
     * @param {object} path
     * @param {{id:number, length:number, type:number}} run
     * @param {boolean} [sync] - emit a BeltItemSyncEvent (client snaps the sprite in place) rather
     *     than a BeltItemUpsertEvent (client glides it); used when re-syncing an edit that didn't move it
     * @returns {BeltItemUpsertEvent|BeltItemSyncEvent|null}
     */
    _itemUpsertEvent(path, run, sync=false) {
        const head = this._headInfo(path);
        if (head === null) {
            return null;
        }
        const EventClass = sync ? BeltItemSyncEvent : BeltItemUpsertEvent;
        return new EventClass(head.x, head.y, head.pathId, run.id, run.length, run.type);
    }

    /**
     * @private
     * @param {object} path
     * @param {number} runId
     * @returns {void}
     */
    _emitItemDelete(path, runId) {
        const head = this._headInfo(path);
        if (head === null) {
            return;
        }
        this.engine.emitEvent(new BeltItemDeleteEvent(head.x, head.y, head.pathId, runId));
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
        this.engine.release([{x, y, layer: this._beltLayer(direction, belt.type)}]);

        // The belts this one linked to — the belt ahead and every belt that fed its tile — anchor the
        // surviving runs. Captured before removal, while the flow links are intact.
        const neighbors = [];
        const ahead = this._flowInto(belt);
        if (ahead !== undefined) {
            neighbors.push(ahead);
        }
        [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT].forEach(d => {
            this._beltsAt(x - Direction.dx(d), y - Direction.dy(d)).forEach(feeder => {
                if (this._flowInto(feeder) === belt) {
                    neighbors.push(feeder);
                }
            });
        });

        // Capture the paths holding this belt (with their item layout) before dropping them, so each
        // surviving sub-run keeps the items that were physically on its belts.
        const source = this.paths.filter(path => path.beltIds.includes(removedId));
        this.paths = this.paths.filter(path => {
            if (path.beltIds.includes(removedId)) {
                this._forgetPath(path);
                return false;
            }
            return true;
        });
        this._removeBeltObject(belt);

        // Rebuild each surviving neighbor's run into its own path (split or shortened), carrying the
        // items that sat on its belts in the removed path.
        const covered = new Set();
        const affected = [];
        neighbors.forEach(neighbor => {
            if (covered.has(neighbor.id) || this.beltById(neighbor.id) === null) {
                return;
            }
            const run = this._collectRun(neighbor);
            const {orphans} = this._removePathsOverlapping(run);
            const segments = this._segmentByChunk(run);
            if (segments.length === 1) {
                // A single-chunk sub-run keeps the items that sat on its belts in the removed path.
                const from = source.find(path => run.every(runBelt => path.beltIds.includes(runBelt.id)));
                const state = from === undefined ? {items: []} : this._carryItemsForSubrun(from, run);
                this._trackPath(this._makePath(run, state));
            } else {
                // A run spanning chunk borders rebuilds empty per-chunk (cross-chunk item preservation deferred).
                this._buildEmptyChain(segments);
            }
            run.forEach(runBelt => {
                covered.add(runBelt.id);
                affected.push(tileKey(runBelt.x, runBelt.y));
            });
            this._rebuildOrphans(orphans, run).forEach(runBelt => affected.push(tileKey(runBelt.x, runBelt.y)));
        });
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
        const found = this._allBelts().find(belt => belt.id === id);
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
        run.forEach(cell => {
            const chunk = chunkId(cell.x, cell.y);
            if (chunk !== currentChunk && current.length > 0) {
                segments.push(current);
                current = [];
            }
            currentChunk = chunk;
            current.push(cell);
        });
        if (current.length > 0) {
            segments.push(current);
        }
        return segments;
    }

    /**
     * The path's per-half-tile occupancy, indexed from the input (head) edge: `headGap` empty
     * (GAP) cells, then the RLE items filled toward the output edge.
     * @private
     * @param {object} path
     * @returns {number[]}
     */
    _occupancyFromInput(path) {
        const occ = new Array(path.length).fill(GAP);
        // RLE runs are ordered output -> input, so fill from the output end inward.
        let pos = path.length - 1;
        path.items.forEach(run => {
            for (let k = 0; k < run.length; k += 1) {
                occ[pos] = run.type;
                pos -= 1;
            }
        });
        return occ;
    }

    /**
     * Rebuilds `{items, headGap}` from a per-half-tile occupancy slice (indexed from the input edge):
     * the leading empty cells are the head-gap, the rest become RLE runs ordered output -> input.
     * @private
     * @param {number[]} occ
     * @returns {{items:object[], headGap:number}}
     */
    _rleFromOccupancy(occ) {
        let headGap = 0;
        while (headGap < occ.length && occ[headGap] === GAP) {
            headGap += 1;
        }
        const runs = [];
        let i = headGap;
        while (i < occ.length) {
            const type = occ[i];
            let length = 0;
            while (i < occ.length && occ[i] === type) {
                length += 1;
                i += 1;
            }
            runs.push({type, length});
        }
        // runs are input -> output; the RLE stores them output -> input.
        const items = runs.reverse().map(run => {
            const item = {id: this._nextRunId, length: run.length, type: run.type};
            this._nextRunId += 1;
            return item;
        });
        return {items, headGap};
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

        removed.forEach(path => {
            const sourceOcc = this._occupancyFromInput(path);
            path.beltIds.forEach((id, oldIdx) => {
                const j = newIndex.get(id);
                if (j === undefined) {
                    return;
                }
                // Each belt's output half carries its content; a belt that had an input half (non-head in
                // the source) keeps it too when it still has one in the merged run.
                occ[j === 0 ? 0 : 2 * j] = sourceOcc[oldIdx === 0 ? 0 : 2 * oldIdx];
                if (j > 0 && oldIdx > 0) {
                    occ[2 * j - 1] = sourceOcc[2 * oldIdx - 1];
                }
            });

            // A resting out-port item buried by the merge re-enters at the downstream belt's input half.
            const outItem = this.engine.Port.item[path.outPort];
            const tail = newIndex.get(path.beltIds[path.beltIds.length - 1]);
            if (outItem !== EMPTY && tail !== undefined && tail + 1 < run.length) {
                occ[2 * (tail + 1) - 1] = outItem;
                this.engine.Port.item[path.outPort] = EMPTY;
            }
            // A resting in-port item buried by the merge re-enters at the head belt's input half.
            const inItem = this.engine.Port.item[path.inPort];
            const head = newIndex.get(path.beltIds[0]);
            if (inItem !== EMPTY && head !== undefined && head > 0) {
                occ[2 * head - 1] = inItem;
                this.engine.Port.item[path.inPort] = EMPTY;
            }
        });

        return this._rleFromOccupancy(occ);
    }

    /**
     * The items to carry onto a sub-run split off `sourcePath` by a deletion: the occupancy of the
     * sub-run's belts in the source path, re-RLE'd. Empty unless the sub-run is a contiguous slice of
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
        return this._rleFromOccupancy(occ.slice(startSlot, 2 * b + 1));
    }

    /**
     * A new path record over `runBelts` (head -> tail) with the given items/head-gap. The head belt id
     * is the client path id; the tail's downstream edge is the out-port.
     * @private
     * @param {object[]} runBelts
     * @param {{items:object[], headGap?:number}} state
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
        const eid = addEntity(this.engine.world);
        addComponent(this.engine.world, eid, {});
        return {
            id: eid,
            belts: runBelts.map(belt => tileKey(belt.x, belt.y)),
            beltIds: runBelts.map(belt => belt.id),
            inPort,
            outPort,
            length,
            headGap: headGap === undefined ? length : headGap,
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
        built.forEach(path => this._trackPath(path));

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
     * facing) — so seams and adjacent objects adopt the same ports via {@link EcsEngine#portAt}.
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
        const runKeys = run.map(belt => tileKey(belt.x, belt.y));
        const newKey = tileKey(placed.x, placed.y);

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
                // distance from the unchanged output edge (and their run ids).
                items = old.items.map(run => ({id: run.id, length: run.length, type: run.type}));
                headGap = old.headGap + 2;
            } else {
                // Tail (output-edge) extension: the new belt is empty space at the moved-forward output
                // edge. In-flight items keep their distance from the input edge; a resting out-port item
                // re-enters at the new belt's input edge and crosses it before reaching the new out-port.
                const carried = old.items.map(run => ({id: run.id, length: run.length, type: run.type}));
                const resting = this.engine.Port.item[old.outPort];
                if (resting !== EMPTY) {
                    // The out-port item sat at the tail's output edge, so after the extension it rests at
                    // the new belt's input edge — one half-tile from the moved out-port. A single output
                    // gap carries it that last half-tile; it keeps its visual position.
                    items = [
                        {id: this._nextRunId, length: 1, type: GAP},
                        {id: this._nextRunId + 1, length: 1, type: resting},
                        ...carried,
                    ];
                    this._nextRunId += 2;
                    headGap = old.headGap;
                    this.engine.Port.item[old.outPort] = EMPTY;
                } else if (carried.length === 0) {
                    // Empty path: all the new space is head room.
                    items = [];
                    headGap = old.headGap + 2;
                } else {
                    // In-flight items: a leading output gap carries the lead item across the new belt.
                    items = [{id: this._nextRunId, length: 2, type: GAP}, ...carried];
                    this._nextRunId += 1;
                    headGap = old.headGap;
                }
            }
        } else if (removed.length > 0) {
            // A merge (or junction split) that folds one or more item-carrying paths into this run:
            // reconstruct the RLE from each belt's half-tile content.
            ({items, headGap} = this._mergedItems(run, removed));
        }

        // The client orders item rows by id (ascending = output -> input), so renumber the rebuilt run
        // in array order to keep that invariant — a prepended output gap would otherwise sort as
        // input-most and shift the items a tile toward the output. Safe because the edit re-syncs
        // (RESET + snap), so the old sprite ids need not be kept.
        items = items.map(run => {
            const renumbered = {id: this._nextRunId, length: run.length, type: run.type};
            this._nextRunId += 1;
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
        const key = tileKey(x, y);
        const path = this.paths.find(candidate => candidate.belts.includes(key));
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
        const removed = [];
        const orphans = [];
        this.paths = this.paths.filter(path => {
            const overlaps = path.beltIds.some(id => runIds.has(id));
            if (!overlaps) {
                return true;
            }
            path.beltIds.forEach(id => {
                if (!runIds.has(id)) {
                    const belt = this.beltById(id);
                    if (belt !== null) {
                        orphans.push(belt);
                    }
                }
            });
            this._forgetPath(path);
            removed.push(path);
            return false;
        });
        return {removed, orphans};
    }

    /**
     * Records a new path and registers its out-port for item rendering (drawn at the tail tile).
     * @private
     * @param {object} path
     * @returns {void}
     */
    _trackPath(path) {
        this.paths.push(path);
        this._byInPort.set(path.inPort, path);
        const [x, y] = path.belts[path.belts.length - 1].split(",").map(Number);
        this.engine.registerRenderedPort(path.outPort, x, y);
    }

    /**
     * Drops a path's indexes and render registration.
     * @private
     * @param {object} path
     * @returns {void}
     */
    _forgetPath(path) {
        this._byInPort.delete(path.inPort);
        this.engine.unregisterRenderedPort(path.outPort);
        // Clear the client's item sprites for this (soon-stale) path id.
        this._emitItemReset(path);
    }

    /**
     * Creates an empty straight path of `beltCount` belts. Its out-port is fresh; its in-port is
     * `inPort` when given (a shared seam with an upstream path's out-port) else a fresh input port.
     * @param {number} beltCount
     * @param {number} [inPort] - existing port to reuse as the in-port (seam)
     * @returns {{id:number, inPort:number, outPort:number, length:number}}
     */
    addPath(beltCount, inPort) {
        const resolvedInPort = inPort === undefined ? this.engine.addPort() : inPort;
        const outPort = this.engine.addPort();
        const length = beltCount * 2 - 1;

        const eid = addEntity(this.engine.world);
        const path = {id: eid, inPort: resolvedInPort, outPort, length, headGap: length, items: []};
        addComponent(this.engine.world, eid, {});
        this.paths.push(path);
        this._byInPort.set(resolvedInPort, path);

        return {id: eid, inPort: resolvedInPort, outPort, length};
    }

    /**
     * @private
     * @param {object} path
     * @returns {number} index of the first gap run, or -1
     */
    _firstGap(path) {
        return path.items.findIndex(run => run.type === GAP);
    }

    /**
     * @private
     * @param {object} path
     * @returns {number} index of the first item run, or -1
     */
    _firstItem(path) {
        return path.items.findIndex(run => run.type !== GAP);
    }

    /**
     * SUBMIT_INTENTS: a path whose lead run is an item submits the virtual shift intent
     * (in-port -> out-port, managed=0) so the resolver frees the out-port; a path with head room or a
     * gap declares its in-port drainable (destination-less) so an upstream transfer can resolve.
     * @private
     * @returns {void}
     */
    _submitIntents() {
        const P = this.engine.Port.item;
        this.paths.forEach(path => {
            const firstGap = this._firstGap(path);
            const firstItem = this._firstItem(path);
            const leadIsItem = firstItem !== -1 && (firstGap === -1 || firstItem < firstGap);
            if (leadIsItem) {
                // The out-port is free if empty, or if the downstream path can ingest this tick (head
                // room or a gap), letting the resolver's chain shift the whole packed run at once.
                const downstream = this._byInPort.get(path.outPort);
                const downstreamCanIngest = downstream !== undefined
                    && (downstream.headGap > 0 || this._firstGap(downstream) !== -1);
                this.engine.submitIntent({
                    source: path.inPort,
                    dest: path.outPort,
                    destEmpty: P[path.outPort] === EMPTY || downstreamCanIngest,
                    managed: false,
                });
            }
            if (P[path.inPort] !== EMPTY && (path.headGap > 0 || firstGap !== -1)) {
                this.engine.submitIntent({source: path.inPort, dest: EMPTY, managed: false});
            }
        });
    }

    /**
     * POST_RESOLVE: move each path one half-tile (pop the lead item, or shrink the lead gap), grow
     * head_gap accordingly, then ingest a resting in-port item at the input edge.
     * @private
     * @returns {void}
     */
    _move() {
        const P = this.engine.Port.item;

        // Phase 1: move each path one half-tile (pop the lead item or shrink the lead gap), buffering
        // pops. Out-port writes are deferred so a shared seam still holds last tick's value when the
        // downstream ingests below (an item rests a tick in the seam).
        const pops = [];
        this.paths.forEach(path => {
            const firstGap = this._firstGap(path);
            const firstItem = this._firstItem(path);
            const hasGap = firstGap !== -1;
            const canPop = this.engine.resolvedUnmanagedDest(path.outPort);
            const leadIsItem = firstItem !== -1 && (firstGap === -1 || firstItem < firstGap);

            let popped = false;
            if (leadIsItem && canPop) {
                pops.push({outPort: path.outPort, type: path.items[0].type});
                this._emitItemDelete(path, path.items[0].id);
                path.items.shift();
                popped = true;
            } else if (hasGap && (firstGap < firstItem || firstItem === -1 || !canPop)) {
                const gap = path.items[firstGap];
                gap.length -= 1;
                if (gap.length === 0) {
                    this._emitItemDelete(path, gap.id);
                    path.items.splice(firstGap, 1);
                } else {
                    this._emitItemUpsert(path, gap);
                }
            }

            if (hasGap || popped) {
                path.headGap += 1;
            }
        });

        // Phase 2: ingest each path's resting in-port item at the input edge, filling the head room.
        this.paths.forEach(path => {
            if (path.headGap > 0 && P[path.inPort] !== EMPTY) {
                if (path.headGap > 1) {
                    const gap = {id: this._nextRunId, length: path.headGap - 1, type: GAP};
                    this._nextRunId += 1;
                    path.items.push(gap);
                    this._emitItemUpsert(path, gap);
                }
                const item = {id: this._nextRunId, length: 1, type: P[path.inPort]};
                this._nextRunId += 1;
                path.items.push(item);
                this._emitItemUpsert(path, item);
                path.headGap = 0;
                P[path.inPort] = EMPTY;
            }
        });

        // Phase 3: write this tick's pops into their out-ports.
        pops.forEach(pop => {
            P[pop.outPort] = pop.type;
        });
    }

    /**
     * The events recreating this module's belts and their resting items in `chunk`, for a session that
     * just subscribed: one "belt" event per belt tile, one "set" event per rendered out-port holding
     * an item.
     * @param {number} chunk
     * @returns {object[]}
     */
    chunkSync(chunk) {
        const events = [];
        this._allBelts().forEach(belt => {
            if (chunkId(belt.x, belt.y) === chunk) {
                events.push(new BeltSyncEvent(belt.x, belt.y, belt.id, belt.direction, belt.type));
            }
        });
        this.paths.forEach(path => {
            const [headX, headY] = path.belts[0].split(",").map(Number);
            if (chunkId(headX, headY) === chunk) {
                events.push(this._pathRecalcEvent(path));
                path.items.forEach(run => events.push(this._itemUpsertEvent(path, run)));
            }
        });
        return events;
    }

    /**
     * Serialize hook: flushes the JS runtime (paths, belts, RLE runs) into the BeltPath/Belt/BeltRun
     * components so the generic snapshot captures belts. Prior save entities are cleared first; the
     * shared Port entities carry the port items, referenced here by eid.
     * @private
     * @returns {void}
     */
    _materialize() {
        [this._runDef, this._beltDef, this._pathDef].forEach(def => {
            this.engine.entitiesWith(def).forEach(eid => this.engine.destroyEntity(eid));
        });

        const BP = this._pathDef.store;
        const B = this._beltDef.store;
        const R = this._runDef.store;
        this.paths.forEach(path => {
            // Synthetic belt-less paths (test-only addPath) have no belt tiles to model; skip them.
            if (path.beltIds === undefined) {
                return;
            }
            const pathEid = this.engine.createEntity(this._pathDef);
            BP.inPort[pathEid] = path.inPort;
            BP.outPort[pathEid] = path.outPort;
            BP.headGap[pathEid] = path.headGap;
            BP.length[pathEid] = path.length;

            path.beltIds.forEach((beltId, index) => {
                const belt = this.beltById(beltId);
                const beltEid = this.engine.createEntity(this._beltDef);
                B.path[beltEid] = pathEid;
                B.index[beltEid] = index;
                B.x[beltEid] = belt.x;
                B.y[beltEid] = belt.y;
                B.direction[beltEid] = belt.direction;
                B.type[beltEid] = belt.type;
                B.objectId[beltEid] = beltId;
            });

            path.items.forEach((run, seq) => {
                const runEid = this.engine.createEntity(this._runDef);
                R.path[runEid] = pathEid;
                R.seq[runEid] = seq;
                R.length[runEid] = run.length;
                R.type[runEid] = run.type;
                R.runId[runEid] = run.id;
            });
        });

        this.engine.globals.beltNextRunId = this._nextRunId;
    }

    /**
     * Rebuild hook: reconstructs the JS runtime from the BeltPath/Belt/BeltRun components a load
     * repopulated, re-linking each path's belts, items, and ports and re-registering its rendered
     * out-port.
     * @private
     * @returns {void}
     */
    _reconstruct() {
        this.paths = [];
        this._byInPort = new Map();
        this._belts = new Map();
        this._nextRunId = this.engine.globals.beltNextRunId;

        const BP = this._pathDef.store;
        const B = this._beltDef.store;
        const R = this._runDef.store;

        const beltsByPath = new Map();
        this.engine.entitiesWith(this._beltDef).forEach(eid => {
            const belt = {x: B.x[eid], y: B.y[eid], direction: B.direction[eid], type: B.type[eid], id: B.objectId[eid]};
            this._addBelt(belt);
            const pathEid = B.path[eid];
            if (!beltsByPath.has(pathEid)) {
                beltsByPath.set(pathEid, []);
            }
            beltsByPath.get(pathEid).push({index: B.index[eid], belt});
        });

        const runsByPath = new Map();
        this.engine.entitiesWith(this._runDef).forEach(eid => {
            const pathEid = R.path[eid];
            if (!runsByPath.has(pathEid)) {
                runsByPath.set(pathEid, []);
            }
            runsByPath.get(pathEid).push({seq: R.seq[eid], run: {id: R.runId[eid], length: R.length[eid], type: R.type[eid]}});
        });

        this.engine.entitiesWith(this._pathDef).forEach(pathEid => {
            const belts = (beltsByPath.get(pathEid) || []).sort((a, b) => a.index - b.index).map(entry => entry.belt);
            const items = (runsByPath.get(pathEid) || []).sort((a, b) => a.seq - b.seq).map(entry => entry.run);
            const path = {
                id: pathEid,
                belts: belts.map(belt => tileKey(belt.x, belt.y)),
                beltIds: belts.map(belt => belt.id),
                inPort: BP.inPort[pathEid],
                outPort: BP.outPort[pathEid],
                length: BP.length[pathEid],
                headGap: BP.headGap[pathEid],
                items,
            };
            this._trackPath(path);
        });
    }

}
