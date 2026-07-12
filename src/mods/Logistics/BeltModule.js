import {addEntity, addComponent} from "bitecs";
import {TickPhase, Direction} from "@/sdk/common.js";
import {chunkId} from "@/common/util.js";
import {EMPTY} from "@/common/sim/EcsEngine.js";
// Layering debt: the ECS content modules live in common/sim/ but emit mod-owned belt events. They
// belong in mods/Logistics/ (see project_bitecs_migration memory); this import crosses the layer for now.
import {BeltInsertEvent, BeltSyncEvent, BeltDeleteEvent, BeltPathRecalculateEvent} from "./events.js";
import {
    BELT_NORMAL,
    BELT_UNDERGROUND,
    BUFFERED_EVENT_TYPE_ITEM_UPSERT,
    BUFFERED_EVENT_TYPE_ITEM_DELETE,
    BUFFERED_EVENT_TYPE_ITEM_RESET,
} from "./constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
import {BufferedEvent} from "@/common/BufferedEvent.js";

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
 * growing head_gap, then a resting in-port item is ingested at the input edge. Mirrors the SQL belt
 * movement ops.
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
        // Stable RLE run id (BigInt), the client's item row_id for sprite continuity/glide.
        this._nextRunId = 1n;

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._move());
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

        const newKey = tileKey(x, y);
        const placed = {x, y, direction, type, id: this.engine.allocateObjectId()};
        this._addBelt(placed);

        const run = this._collectRun(x, y, direction);
        const segments = this._segmentByChunk(run);

        // A run that stays inside one chunk (re)builds a single path, preserving in-flight items on an
        // end extension. A run spanning chunk borders becomes one path per chunk, seam-connected — the
        // hard constraint that paths never cross chunks. Cross-chunk edits rebuild empty for now.
        const result = segments.length === 1
            ? this._placeSingleChunk(run, newKey, direction)
            : this._buildEmptyChain(segments, run, direction);

        this.engine.emitEvent(new BeltInsertEvent(x, y, placed.id, direction, placed.type));
        this._emitPathRecalcs(run);
        return result;
    }

    /**
     * Emits a path-recalc event for every rebuilt path touching `run`, so the client re-links its belt
     * geometry.
     * @private
     * @param {{x:number, y:number}[]} run
     * @returns {void}
     */
    _emitPathRecalcs(run) {
        const runKeys = new Set(run.map(cell => tileKey(cell.x, cell.y)));
        this.paths.forEach(path => {
            if (path.belts.some(key => runKeys.has(key))) {
                this.engine.emitEvent(this._pathRecalcEvent(path));
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
        const parts = [...path.belts].reverse().map(key => {
            const [kx, ky] = key.split(",").map(Number);
            return this._beltAt(kx, ky, path.direction).id;
        });
        const [headX, headY] = path.belts[0].split(",").map(Number);
        return new BeltPathRecalculateEvent(headX, headY, parts, BigInt(path.outPort));
    }

    /**
     * The client path id (head belt id) and head-tile routing chunk, or null for a synthetic path
     * without belts (test-only addPath), which emits no client events.
     * @private
     * @param {object} path
     * @returns {{pathId: BigInt, chunkX: number, chunkY: number}|null}
     */
    _headInfo(path) {
        if (path.belts === undefined) {
            return null;
        }
        const [x, y] = path.belts[0].split(",").map(Number);
        return {
            pathId: this._beltAt(x, y, path.direction).id,
            chunkX: Math.floor(x / CHUNK_SIZE),
            chunkY: Math.floor(y / CHUNK_SIZE),
        };
    }

    /**
     * @private
     * @param {object} path
     * @param {{id:BigInt, length:number, type:number}} run
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
     * @param {{id:BigInt, length:number, type:number}} run
     * @returns {BufferedEvent|null}
     */
    _itemUpsertEvent(path, run) {
        const head = this._headInfo(path);
        if (head === null) {
            return null;
        }
        return new BufferedEvent({
            type: BUFFERED_EVENT_TYPE_ITEM_UPSERT,
            routing_chunk_x: head.chunkX,
            routing_chunk_y: head.chunkY,
            id: head.pathId,
            a: run.id,
            b: run.length,
            c: run.type,
        });
    }

    /**
     * @private
     * @param {object} path
     * @param {BigInt} runId
     * @returns {void}
     */
    _emitItemDelete(path, runId) {
        const head = this._headInfo(path);
        if (head === null) {
            return;
        }
        this.engine.emitEvent(new BufferedEvent({
            type: BUFFERED_EVENT_TYPE_ITEM_DELETE,
            routing_chunk_x: head.chunkX,
            routing_chunk_y: head.chunkY,
            id: head.pathId,
            a: runId,
        }));
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
        this.engine.emitEvent(new BufferedEvent({
            type: BUFFERED_EVENT_TYPE_ITEM_RESET,
            routing_chunk_x: head.chunkX,
            routing_chunk_y: head.chunkY,
            id: head.pathId,
        }));
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
        const key = tileKey(x, y);
        const removedId = belt.id;
        this.engine.release([{x, y, layer: this._beltLayer(direction, belt.type)}]);

        // Drop the same-direction path that held it (and any seam-connected segments of that run). The
        // belt stays in the registry here so _forgetPath can still resolve the path's head belt.
        this.paths = this.paths.filter(path => {
            if (path.direction === direction && path.belts.includes(key)) {
                this._forgetPath(path);
                return false;
            }
            return true;
        });
        this._removeBeltObject(belt);

        // Rebuild the runs anchored by the two former same-direction neighbors.
        const fdx = Direction.dx(direction);
        const fdy = Direction.dy(direction);
        [[x - fdx, y - fdy], [x + fdx, y + fdy]].forEach(([nx, ny]) => {
            if (this._beltAt(nx, ny, direction) !== undefined) {
                const run = this._collectRun(nx, ny, direction);
                this._buildEmptyChain(this._segmentByChunk(run), run, direction);
                this._emitPathRecalcs(run);
            }
        });

        this.engine.emitEvent(new BeltDeleteEvent(x, y, removedId));
    }

    /**
     * Removes the belt with client-facing `id`, if it is one of this module's belts.
     * @param {BigInt} id
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
     * The placed belt with client-facing `id`, or null.
     * @param {BigInt} id
     * @returns {{x:number, y:number, direction:number, type:number, id:BigInt}|null}
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
     * Builds a per-chunk chain of empty seam-connected paths (each segment's out-port is the next
     * segment's in-port). Returns the whole chain's endpoints and segment path ids.
     * @private
     * @param {{x:number, y:number}[][]} segments
     * @param {{x:number, y:number}[]} run
     * @returns {{id:number, inPort:number, outPort:number, segments:number[]}}
     */
    _buildEmptyChain(segments, run, direction) {
        this._removePathsOverlapping(run, direction);

        const built = [];
        segments.forEach(segment => {
            const {inPort, outPort} = this._pathPorts(segment, direction);
            const length = segment.length * 2 - 1;
            const eid = addEntity(this.engine.world);
            addComponent(this.engine.world, eid, {});
            const path = {
                id: eid,
                belts: segment.map(cell => tileKey(cell.x, cell.y)),
                direction,
                inPort,
                outPort,
                length,
                headGap: length,
                items: [],
            };
            this._trackPath(path);
            built.push(path);
        });

        return {
            id: built[0].id,
            inPort: built[0].inPort,
            outPort: built[built.length - 1].outPort,
            segments: built.map(path => path.id),
        };
    }

    /**
     * The shared in/out ports for a run (cells head -> tail): the in-port is the edge feeding the head
     * tile; the out-port is the edge the tail feeds downstream — so seams and adjacent objects adopt
     * the same ports via {@link EcsEngine#portAt}.
     * @private
     * @param {{x:number, y:number}[]} cells
     * @returns {{inPort:number, outPort:number}}
     */
    _pathPorts(cells, direction) {
        const head = cells[0];
        const tail = cells[cells.length - 1];
        const fdx = Direction.dx(direction);
        const fdy = Direction.dy(direction);
        return {
            inPort: this.engine.portAt(head.x, head.y, direction),
            outPort: this.engine.portAt(tail.x + fdx, tail.y + fdy, direction),
        };
    }

    /**
     * (Re)builds the single-chunk run through the placed belt into one path, preserving in-flight
     * items when it is an end extension of one existing path.
     * @private
     * @param {{x:number, y:number}[]} run
     * @param {string} newKey
     * @returns {{id:number, inPort:number, outPort:number, length:number, segments:number[]}}
     */
    _placeSingleChunk(run, newKey, direction) {
        const runKeys = run.map(cell => tileKey(cell.x, cell.y));
        const overlapping = this.paths.filter(path => path.direction === direction && path.belts.some(key => runKeys.includes(key)));

        // Extending one existing path at an end preserves its in-flight items; anything else (a fresh
        // isolated belt, or a merge of two item-carrying paths — not yet supported) rebuilds empty.
        let items;
        let headGap;
        const length = run.length * 2 - 1;
        if (overlapping.length === 1 && this._isEndExtension(runKeys, overlapping[0].belts, newKey)) {
            const old = overlapping[0];
            if (runKeys[0] === newKey) {
                // Head (input-edge) extension: the new empty belt is head room; items keep their
                // distance from the unchanged output edge (and their run ids).
                items = old.items.map(run => ({id: run.id, length: run.length, type: run.type}));
                headGap = old.headGap + 2;
            } else {
                // Tail (output-edge) extension of an empty path merges into the same path (all added
                // space is head room). Downstream placement onto a path carrying in-flight items is
                // NOT this case in SQL — it builds a separate seam-connected path; that belongs with
                // the deferred merge/relink logic, so only the empty case is handled here.
                items = [];
                headGap = old.headGap + 2;
            }
        } else {
            items = [];
            headGap = length;
        }

        this._removePathsOverlapping(run, direction);

        // Ports derive from the run's tiles, so extensions/seams/objects share the same edge ports.
        const {inPort, outPort} = this._pathPorts(run, direction);
        const eid = addEntity(this.engine.world);
        addComponent(this.engine.world, eid, {});
        const path = {id: eid, belts: runKeys, direction, inPort, outPort, length, headGap, items};
        this._trackPath(path);

        return {id: eid, inPort, outPort, length, segments: [eid]};
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
     * The maximal straight run of same-direction belts through (x, y), ordered head (most upstream,
     * in-port) -> tail (most downstream, out-port).
     * @private
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {{x:number, y:number}[]}
     */
    _collectRun(x, y, direction) {
        const fdx = Direction.dx(direction);
        const fdy = Direction.dy(direction);
        const sameDirBelt = (cx, cy) => this._beltAt(cx, cy, direction) !== undefined;

        // Walk upstream to the head (parent feeds from behind the forward vector).
        let hx = x;
        let hy = y;
        while (sameDirBelt(hx - fdx, hy - fdy)) {
            hx -= fdx;
            hy -= fdy;
        }

        // Collect downstream from the head to the tail.
        const run = [];
        let cx = hx;
        let cy = hy;
        while (sameDirBelt(cx, cy)) {
            run.push({x: cx, y: cy});
            cx += fdx;
            cy += fdy;
        }
        return run;
    }

    /**
     * Drops any existing path records that share a belt with `run`.
     * @private
     * @param {{x:number, y:number}[]} run
     * @returns {void}
     */
    _removePathsOverlapping(run, direction) {
        const runKeys = new Set(run.map(cell => tileKey(cell.x, cell.y)));
        this.paths = this.paths.filter(path => {
            // Only same-direction paths share belts with the run — a crossing perpendicular path shares
            // a tile but not a belt, so it must survive.
            const overlaps = path.direction === direction && path.belts.some(key => runKeys.has(key));
            if (overlaps) {
                this._forgetPath(path);
            }
            return !overlaps;
        });
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
        // Re-sync any preserved items under the (possibly new) path id.
        path.items.forEach(run => this._emitItemUpsert(path, run));
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
        // downstream ingests below (an item rests a tick in the seam, as the SQL FillOutPort order does).
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
                    this._nextRunId += 1n;
                    path.items.push(gap);
                    this._emitItemUpsert(path, gap);
                }
                const item = {id: this._nextRunId, length: 1, type: P[path.inPort]};
                this._nextRunId += 1n;
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
     * A serializable snapshot of all belt state: the tile registry, every path (belts, length,
     * head_gap, RLE items), and the referenced ports (item + a serial index so a seam port shared by
     * two paths restores as one port).
     * @returns {object}
     */
    captureState() {
        const portSerials = new Map();
        const ports = [];
        const serialFor = eid => {
            if (!portSerials.has(eid)) {
                portSerials.set(eid, ports.length);
                ports.push({item: this.engine.portItem(eid)});
            }
            return portSerials.get(eid);
        };
        const paths = this.paths.map(path => ({
            belts: [...path.belts],
            direction: path.direction,
            length: path.length,
            headGap: path.headGap,
            items: path.items.map(run => ({id: String(run.id), length: run.length, type: run.type})),
            inPort: serialFor(path.inPort),
            outPort: serialFor(path.outPort),
        }));
        const belts = this._allBelts().map(belt => ({x: belt.x, y: belt.y, direction: belt.direction, type: belt.type, id: String(belt.id)}));
        return {ports, paths, belts, nextObjectId: String(this.engine._nextObjectId), nextRunId: String(this._nextRunId)};
    }

    /**
     * Rebuilds this module's state from a {@link snapshot}, allocating fresh ports (seam sharing is
     * preserved via the snapshot's serial indices).
     * @param {object} snapshot
     * @returns {void}
     */
    restore(snapshot) {
        const portEids = snapshot.ports.map(port => {
            const eid = this.engine.addPort();
            this.engine.setPortItem(eid, port.item);
            return eid;
        });

        this._belts = new Map();
        snapshot.belts.forEach(belt => this._addBelt({x: belt.x, y: belt.y, direction: belt.direction, type: belt.type, id: BigInt(belt.id)}));
        this.engine._nextObjectId = BigInt(snapshot.nextObjectId);
        this._nextRunId = BigInt(snapshot.nextRunId);
        this.paths = [];
        this._byInPort = new Map();

        snapshot.paths.forEach(saved => {
            const inPort = portEids[saved.inPort];
            const outPort = portEids[saved.outPort];
            const eid = addEntity(this.engine.world);
            addComponent(this.engine.world, eid, {});
            const path = {
                id: eid,
                belts: [...saved.belts],
                direction: saved.direction,
                inPort,
                outPort,
                length: saved.length,
                headGap: saved.headGap,
                items: saved.items.map(run => ({id: BigInt(run.id), length: run.length, type: run.type})),
            };
            this._trackPath(path);
        });
    }

    /**
     * The path's RLE runs ordered output-edge -> input-edge, plus head_gap and out-port item, for
     * differential comparison against the SQL BeltPathItem rows.
     * @param {number} eid
     * @returns {{items:{length:number,type:number}[], headGap:number, out:number}}
     */
    snapshot(eid) {
        const path = this.paths.find(candidate => candidate.id === eid);
        return {
            items: path.items.map(run => ({length: run.length, type: run.type})),
            headGap: path.headGap,
            out: this.engine.portItem(path.outPort),
        };
    }
}
