import {addEntity, addComponent} from "bitecs";
import {TickPhase} from "@/common/core.js";
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
