import {addEntity, addComponent} from "bitecs";
import {TickPhase, Direction} from "@/sdk/common.js";
import {chunkId} from "@/common/util.js";
import {EMPTY} from "@/common/sim/EcsEngine.js";

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
        // Placed belts by tile key: {x, y, direction}. Only straight normal belts for now.
        this._belts = new Map();

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._move());
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
    placeBelt(x, y, direction) {
        const newKey = tileKey(x, y);
        this._belts.set(newKey, {x, y, direction});

        const run = this._collectRun(x, y, direction);
        const segments = this._segmentByChunk(run);

        // A run that stays inside one chunk (re)builds a single path, preserving in-flight items on an
        // end extension. A run spanning chunk borders becomes one path per chunk, seam-connected — the
        // hard constraint that paths never cross chunks. Cross-chunk edits rebuild empty for now.
        if (segments.length === 1) {
            return this._placeSingleChunk(run, newKey);
        }
        return this._buildEmptyChain(segments, run);
    }

    /**
     * Removes the belt at (x, y), rebuilding the surviving runs on each side (the path splits, or
     * shortens). Rebuilt empty for now — in-flight-item preservation across deletion is deferred.
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    removeBelt(x, y) {
        const key = tileKey(x, y);
        const belt = this._belts.get(key);
        if (belt === undefined) {
            return;
        }
        const direction = belt.direction;
        this._belts.delete(key);

        // Drop the path that held it (and any seam-connected segments of that same run).
        this.paths = this.paths.filter(path => {
            if (path.belts.includes(key)) {
                this._forgetPath(path);
                return false;
            }
            return true;
        });

        // Rebuild the runs anchored by the two former neighbors.
        const fdx = Direction.dx(direction);
        const fdy = Direction.dy(direction);
        [[x - fdx, y - fdy], [x + fdx, y + fdy]].forEach(([nx, ny]) => {
            const neighbor = this._belts.get(tileKey(nx, ny));
            if (neighbor !== undefined && neighbor.direction === direction) {
                const run = this._collectRun(nx, ny, direction);
                this._buildEmptyChain(this._segmentByChunk(run), run);
            }
        });
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
    _buildEmptyChain(segments, run) {
        this._removePathsOverlapping(run);

        let seamPort = null;
        const built = [];
        segments.forEach(segment => {
            const inPort = seamPort === null ? this.engine.addPort() : seamPort;
            const outPort = this.engine.addPort();
            const length = segment.length * 2 - 1;
            const eid = addEntity(this.engine.world);
            addComponent(this.engine.world, eid, {});
            const path = {
                id: eid,
                belts: segment.map(cell => tileKey(cell.x, cell.y)),
                inPort,
                outPort,
                length,
                headGap: length,
                items: [],
            };
            this._trackPath(path);
            built.push(path);
            seamPort = outPort;
        });

        return {
            id: built[0].id,
            inPort: built[0].inPort,
            outPort: built[built.length - 1].outPort,
            segments: built.map(path => path.id),
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
    _placeSingleChunk(run, newKey) {
        const runKeys = run.map(cell => tileKey(cell.x, cell.y));
        const overlapping = this.paths.filter(path => path.belts.some(key => runKeys.includes(key)));

        // Extending one existing path at an end preserves its in-flight items; anything else (a fresh
        // isolated belt, or a merge of two item-carrying paths — not yet supported) rebuilds empty.
        let inPort;
        let outPort;
        let items;
        let headGap;
        const length = run.length * 2 - 1;
        if (overlapping.length === 1 && this._isEndExtension(runKeys, overlapping[0].belts, newKey)) {
            const old = overlapping[0];
            inPort = old.inPort;
            outPort = old.outPort;
            if (runKeys[0] === newKey) {
                // Head (input-edge) extension: the new empty belt is head room; items keep their
                // distance from the unchanged output edge.
                items = old.items.map(run => ({length: run.length, type: run.type}));
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
            inPort = this.engine.addPort();
            outPort = this.engine.addPort();
            items = [];
            headGap = length;
        }

        this._removePathsOverlapping(run);

        const eid = addEntity(this.engine.world);
        addComponent(this.engine.world, eid, {});
        const path = {id: eid, belts: runKeys, inPort, outPort, length, headGap, items};
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
        const sameDirBelt = (cx, cy) => {
            const belt = this._belts.get(tileKey(cx, cy));
            return belt !== undefined && belt.direction === direction;
        };

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
    _removePathsOverlapping(run) {
        const runKeys = new Set(run.map(cell => tileKey(cell.x, cell.y)));
        this.paths = this.paths.filter(path => {
            const overlaps = path.belts.some(key => runKeys.has(key));
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
                path.items.shift();
                popped = true;
            } else if (hasGap && (firstGap < firstItem || firstItem === -1 || !canPop)) {
                path.items[firstGap].length -= 1;
                if (path.items[firstGap].length === 0) {
                    path.items.splice(firstGap, 1);
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
                    path.items.push({length: path.headGap - 1, type: GAP});
                }
                path.items.push({length: 1, type: P[path.inPort]});
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
        this._belts.forEach(belt => {
            if (chunkId(belt.x, belt.y) === chunk) {
                events.push({kind: "belt", x: belt.x, y: belt.y, direction: belt.direction});
            }
        });
        this.engine.renderedPorts.forEach((position, eid) => {
            if (chunkId(position.x, position.y) === chunk) {
                const item = this.engine.portItem(eid);
                if (item !== EMPTY) {
                    events.push({kind: "set", portId: eid, item: item, x: position.x, y: position.y});
                }
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
            length: path.length,
            headGap: path.headGap,
            items: path.items.map(run => ({length: run.length, type: run.type})),
            inPort: serialFor(path.inPort),
            outPort: serialFor(path.outPort),
        }));
        const belts = [...this._belts.entries()].map(([key, belt]) => ({key, x: belt.x, y: belt.y, direction: belt.direction}));
        return {ports, paths, belts};
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

        this._belts = new Map(snapshot.belts.map(belt => [belt.key, {x: belt.x, y: belt.y, direction: belt.direction}]));
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
                inPort,
                outPort,
                length: saved.length,
                headGap: saved.headGap,
                items: saved.items.map(run => ({length: run.length, type: run.type})),
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
