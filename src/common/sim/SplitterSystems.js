import {addEntity, addComponent} from "bitecs";
import {TickPhase} from "@/common/core.js";
import {Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {EMPTY} from "@/common/sim/EcsEngine.js";

// Initial Splitter column length; grows by doubling when a splitter eid exceeds it.
const SPLITTER_CAPACITY = 256;

// The Splitter component's columns, all indexed by splitter eid.
const SPLITTER_COLUMNS = ["in_a", "in_b", "out_a", "out_b", "int_a", "int_b", "state"];

/**
 * The Splitter mod on the bitECS engine: a 1x2 router of two inputs and two outputs (ports shared
 * with adjacent belts) through two internal buffer ports. Each item flows in_X -> int_X -> out_Y,
 * resting a tick in int_X (belt speed). Submits managed=0 intents so the shared resolver only links
 * the chain; the POST_RESOLVE seam does the moves — mirroring the SQL Splitter tick ops.
 */
export class SplitterModule {

    /**
     * @param {EcsEngine} engine
     */
    constructor(engine) {
        this.engine = engine;

        this.Splitter = {};
        SPLITTER_COLUMNS.forEach(column => {
            this.Splitter[column] = new Int32Array(SPLITTER_CAPACITY);
        });
        this._capacity = SPLITTER_CAPACITY;

        // Splitter eids, iterated each tick.
        this.ids = [];
        // eid -> {clientId, typeId, x, y, direction} for placed (client-visible) splitters.
        this._meta = new Map();
        // clientId -> eid.
        this._byClientId = new Map();

        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents());
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._runSeam());
    }

    /**
     * @private
     * @param {number} eid
     * @returns {void}
     */
    _ensureCapacity(eid) {
        if (eid < this._capacity) {
            return;
        }
        let capacity = this._capacity;
        while (capacity <= eid) {
            capacity *= 2;
        }
        SPLITTER_COLUMNS.forEach(column => {
            const grown = new Int32Array(capacity);
            grown.set(this.Splitter[column]);
            this.Splitter[column] = grown;
        });
        this._capacity = capacity;
    }

    /**
     * Creates a splitter, state 0. Ports are fresh unless given in `wiring` (e.g. an upstream belt's
     * out-port reused as in_a, or a downstream belt's in-port reused as out_a).
     * @param {{in_a?:number, in_b?:number, out_a?:number, out_b?:number}} [wiring]
     * @returns {{id:number, in_a:number, in_b:number, out_a:number, out_b:number, int_a:number, int_b:number}}
     */
    addSplitter(wiring={}) {
        const port = given => given === undefined ? this.engine.addPort() : given;
        // Ports first so their eids stay contiguous from 1 (aligns with the SQL engine's port ids).
        const in_a = port(wiring.in_a);
        const in_b = port(wiring.in_b);
        const out_a = port(wiring.out_a);
        const out_b = port(wiring.out_b);
        const int_a = this.engine.addPort();
        const int_b = this.engine.addPort();

        const eid = addEntity(this.engine.world);
        addComponent(this.engine.world, eid, this.Splitter);
        this._ensureCapacity(eid);

        const S = this.Splitter;
        S.in_a[eid] = in_a;
        S.in_b[eid] = in_b;
        S.out_a[eid] = out_a;
        S.out_b[eid] = out_b;
        S.int_a[eid] = int_a;
        S.int_b[eid] = int_b;
        S.state[eid] = 0;
        this.ids.push(eid);

        return {id: eid, in_a, in_b, out_a, out_b, int_a, int_b};
    }

    /**
     * Places an UP-facing 1x2 splitter at (x, y), adopting the shared edge ports of adjacent belts:
     * in_a/in_b feed from below (the belts at (x,y)/(x+1,y)), out_a/out_b feed the belts above
     * (x,y-1)/(x+1,y-1). Internal ports are private. Rotation for other directions is not done yet.
     * @param {number} x
     * @param {number} y
     * @returns {{id:number, in_a:number, in_b:number, out_a:number, out_b:number, int_a:number, int_b:number}}
     */
    placeSplitter(x, y, typeId=null, direction=Direction.UP, ports=null) {
        // Default UP geometry for sim-only placement (tests); a real message placement passes the
        // rotated ports + render tiles from the definition.
        const p = ports === null ? {
            in_a: this.engine.portAt(x, y, Direction.UP),
            in_b: this.engine.portAt(x + 1, y, Direction.UP),
            out_a: this.engine.portAt(x, y - 1, Direction.UP),
            out_b: this.engine.portAt(x + 1, y - 1, Direction.UP),
            outATile: {x, y: y - 1},
            outBTile: {x: x + 1, y: y - 1},
        } : ports;

        const handle = this.addSplitter({in_a: p.in_a, in_b: p.in_b, out_a: p.out_a, out_b: p.out_b});
        if (typeId !== null) {
            const clientId = this.engine.allocateObjectId();
            handle.clientId = clientId;
            this._meta.set(handle.id, {clientId, typeId, x, y, direction});
            this._byClientId.set(clientId, handle.id);
            this.engine.registerRenderedPort(handle.out_a, p.outATile.x, p.outATile.y);
            this.engine.registerRenderedPort(handle.out_b, p.outBTile.x, p.outBTile.y);
            this.engine.emitEvent(new EasyObjectInsertEvent(
                typeId, clientId, x, y, direction, [BigInt(handle.out_a), BigInt(handle.out_b)], null,
            ));
        }
        return handle;
    }

    /**
     * The EasyObjectSyncEvents recreating this module's placed splitters in `chunk`.
     * @param {number} chunk
     * @returns {EasyObjectSyncEvent[]}
     */
    chunkSync(chunk) {
        const events = [];
        this._meta.forEach((meta, eid) => {
            if (chunkId(meta.x, meta.y) === chunk) {
                events.push(new EasyObjectSyncEvent(
                    meta.typeId, meta.clientId, meta.x, meta.y, meta.direction,
                    [BigInt(this.Splitter.out_a[eid]), BigInt(this.Splitter.out_b[eid])], null,
                ));
            }
        });
        return events;
    }

    /**
     * Removes the placed splitter with client id `clientId`, if any.
     * @param {BigInt} clientId
     * @returns {boolean}
     */
    removeSplitterById(clientId) {
        const eid = this._byClientId.get(clientId);
        if (eid === undefined) {
            return false;
        }
        const meta = this._meta.get(eid);
        this.ids = this.ids.filter(id => id !== eid);
        this._meta.delete(eid);
        this._byClientId.delete(clientId);
        this.engine.unregisterRenderedPort(this.Splitter.out_a[eid]);
        this.engine.unregisterRenderedPort(this.Splitter.out_b[eid]);
        this.engine.emitEvent(new EasyObjectDeleteEvent(meta.typeId, clientId, meta.x, meta.y));
        return true;
    }

    /**
     * @param {number} eid
     * @returns {number} the splitter's round-robin state bit
     */
    state(eid) {
        return this.Splitter.state[eid];
    }

    /**
     * Stage 1: buffer each loaded input into its internal port (single destination). Stage 2: route
     * each loaded internal port to both outputs as competing fan-out intents, ranked by the
     * round-robin state. All managed=0 — the seam does the moves.
     * @private
     * @returns {void}
     */
    _submitIntents() {
        const item = this.engine.Port.item;
        const S = this.Splitter;
        this.ids.forEach(eid => {
            if (item[S.in_a[eid]] !== EMPTY) {
                this.engine.submitIntent({source: S.in_a[eid], dest: S.int_a[eid], destEmpty: item[S.int_a[eid]] === EMPTY, managed: false});
            }
            if (item[S.in_b[eid]] !== EMPTY) {
                this.engine.submitIntent({source: S.in_b[eid], dest: S.int_b[eid], destEmpty: item[S.int_b[eid]] === EMPTY, managed: false});
            }
            const preferA = S.state[eid] === 0 ? 1 : 2;
            const preferB = S.state[eid] === 0 ? 2 : 1;
            if (item[S.int_a[eid]] !== EMPTY) {
                this.engine.submitIntent({source: S.int_a[eid], dest: S.out_a[eid], destEmpty: item[S.out_a[eid]] === EMPTY, managed: false, rank: preferA});
                this.engine.submitIntent({source: S.int_a[eid], dest: S.out_b[eid], destEmpty: item[S.out_b[eid]] === EMPTY, managed: false, rank: preferB});
            }
            if (item[S.int_b[eid]] !== EMPTY) {
                this.engine.submitIntent({source: S.int_b[eid], dest: S.out_b[eid], destEmpty: item[S.out_b[eid]] === EMPTY, managed: false, rank: preferA});
                this.engine.submitIntent({source: S.int_b[eid], dest: S.out_a[eid], destEmpty: item[S.out_a[eid]] === EMPTY, managed: false, rank: preferB});
            }
        });
    }

    /**
     * The POST_RESOLVE seam: record each resolved int->out and in->int hop and its item, clear the
     * drained sources, buffer inputs into internal ports, then write internal ports out — the same
     * record/clear/fill ordering the SQL seam ops use so items cross at belt speed. Finally advance
     * the round-robin state of every splitter that routed an item.
     * @private
     * @returns {void}
     */
    _runSeam() {
        const item = this.engine.Port.item;
        const S = this.Splitter;
        const stage1 = [];
        const stage2 = [];

        this.ids.forEach(eid => {
            [S.int_a[eid], S.int_b[eid]].forEach(intPort => {
                if (item[intPort] === EMPTY) {
                    return;
                }
                const dest = this.engine.resolvedDestFor(intPort);
                if (dest !== EMPTY) {
                    stage2.push({outPort: dest, item: item[intPort], intPort: intPort});
                }
            });
            [S.in_a[eid], S.in_b[eid]].forEach(inPort => {
                if (item[inPort] === EMPTY) {
                    return;
                }
                const dest = this.engine.resolvedDestFor(inPort);
                if (dest !== EMPTY) {
                    stage1.push({intPort: dest, item: item[inPort], inPort: inPort});
                }
            });
        });

        stage2.forEach(record => {
            item[record.intPort] = EMPTY;
        });
        stage1.forEach(record => {
            item[record.inPort] = EMPTY;
        });
        stage1.forEach(record => {
            item[record.intPort] = record.item;
        });
        stage2.forEach(record => {
            item[record.outPort] = record.item;
        });

        this.ids.forEach(eid => {
            if (this.engine.resolvedDestFor(S.int_a[eid]) !== EMPTY || this.engine.resolvedDestFor(S.int_b[eid]) !== EMPTY) {
                S.state[eid] = 1 - S.state[eid];
            }
        });
    }
}
