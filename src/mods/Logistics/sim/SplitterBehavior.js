import {Direction, EMPTY, NO_EID, TickPhase, AbstractBehavior} from "@/sdk/common.js";
import {ORDER_BEFORE_TRANSPORT} from "../common/constants.js";

/**
 * 1x2 splitter routing in_X -> int_X -> out_Y through internal buffer ports at belt speed,
 * submitting managed=0 intents so the resolver only links and the POST_RESOLVE seam does the moves.
 */
export class SplitterBehavior extends AbstractBehavior {

    install(engine, placed) {
        engine.defineComponent("Splitter", [
            {name: "in_a", kind: "eid", fill: NO_EID},
            {name: "in_b", kind: "eid", fill: NO_EID},
            {name: "out_a", kind: "eid", fill: NO_EID},
            {name: "out_b", kind: "eid", fill: NO_EID},
            {name: "int_a", kind: "eid", fill: NO_EID},
            {name: "int_b", kind: "eid", fill: NO_EID},
            {name: "state"},
        ], {sparse: true});
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents(engine));
        // Seam must read shared ports before the belt transport writes pops.
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._runSeam(engine), ORDER_BEFORE_TRANSPORT);
    }

    onSpawn(engine, placed, eid, type, message) {
        const inA = engine.portFor(type.inputPorts[0], message.x, message.y, message.direction);
        const inB = engine.portFor(type.inputPorts[1], message.x, message.y, message.direction);
        const outA = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        const outB = engine.portFor(type.outputPorts[1], message.x, message.y, message.direction);
        this._wire(engine, eid, {in_a: inA.port, in_b: inB.port, out_a: outA.port, out_b: outB.port});
        engine.registerRenderedPort(outA.port, outA.tile.x, outA.tile.y);
        engine.registerRenderedPort(outB.port, outB.tile.x, outB.tile.y);
    }

    onDespawn(engine, placed, eid) {
        const def = engine.component("Splitter");
        const row = def.row(eid);
        engine.unregisterRenderedPort(def.store.out_a[row]);
        engine.unregisterRenderedPort(def.store.out_b[row]);
    }

    syncData(engine, placed, eid) {
        const def = engine.component("Splitter");
        const row = def.row(eid);
        return {portIds: [def.store.out_a[row], def.store.out_b[row]], lastOutput: null};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const def = engine.component("Splitter");
        const row = def.row(eid);
        for (const out of [def.store.out_a[row], def.store.out_b[row]]) {
            engine.registerRenderedPort(out, engine.Position.x[out], engine.Position.y[out]);
        }
    }

    /**
     * Attaches the Splitter component to `eid` and wires its ports (internal ports created fresh).
     * @private
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {{in_a:number, in_b:number, out_a:number, out_b:number}} ports
     * @returns {{id:number, in_a:number, in_b:number, out_a:number, out_b:number, int_a:number, int_b:number}}
     */
    _wire(engine, eid, ports) {
        const int_a = engine.createPort();
        const int_b = engine.createPort();
        const def = engine.component("Splitter");
        engine.attachComponent(def, eid);
        const splitter = def.store;
        const row = def.row(eid);
        splitter.in_a[row] = ports.in_a;
        splitter.in_b[row] = ports.in_b;
        splitter.out_a[row] = ports.out_a;
        splitter.out_b[row] = ports.out_b;
        splitter.int_a[row] = int_a;
        splitter.int_b[row] = int_b;
        splitter.state[row] = 0;
        return {id: eid, in_a: ports.in_a, in_b: ports.in_b, out_a: ports.out_a, out_b: ports.out_b, int_a, int_b};
    }

    /**
     * Creates a sim-only splitter for specs and debugging; ports fresh unless given in `wiring`.
     * @param {GameEngine} engine
     * @param {{in_a?:number, in_b?:number, out_a?:number, out_b?:number}} [wiring]
     * @returns {{id:number, in_a:number, in_b:number, out_a:number, out_b:number, int_a:number, int_b:number}}
     */
    addSplitter(engine, wiring={}) {
        const port = given => given === undefined ? engine.createPort() : given;
        // Ports first so their eids stay contiguous from 1.
        const ports = {
            in_a: port(wiring.in_a),
            in_b: port(wiring.in_b),
            out_a: port(wiring.out_a),
            out_b: port(wiring.out_b),
        };
        const eid = engine.createEntity(engine.component("Splitter"));
        return this._wire(engine, eid, ports);
    }

    /**
     * Places a sim-only UP-facing splitter at (x, y) adopting adjacent belts' edge ports; for specs and debugging.
     * @param {GameEngine} engine
     * @param {number} x
     * @param {number} y
     * @returns {{id:number, in_a:number, in_b:number, out_a:number, out_b:number, int_a:number, int_b:number}}
     */
    placeSplitter(engine, x, y) {
        return this.addSplitter(engine, {
            in_a: engine.portAt(x, y, Direction.UP),
            in_b: engine.portAt(x + 1, y, Direction.UP),
            out_a: engine.portAt(x, y - 1, Direction.UP),
            out_b: engine.portAt(x + 1, y - 1, Direction.UP),
        });
    }

    /**
     * Submits managed=0 intents: each loaded input to its internal port, each loaded internal port
     * fanned out to both outputs ranked by the round-robin state.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    _submitIntents(engine) {
        const item = engine.Port.item;
        const def = engine.component("Splitter");
        const splitter = def.store;
        for (let row = 0; row < def.count; row += 1) {
            if (item[splitter.in_a[row]] !== EMPTY) {
                engine.submitTransfer(splitter.in_a[row], splitter.int_a[row], item[splitter.int_a[row]] === EMPTY, false);
            }
            if (item[splitter.in_b[row]] !== EMPTY) {
                engine.submitTransfer(splitter.in_b[row], splitter.int_b[row], item[splitter.int_b[row]] === EMPTY, false);
            }
            const preferA = splitter.state[row] === 0 ? 1 : 2;
            const preferB = splitter.state[row] === 0 ? 2 : 1;
            if (item[splitter.int_a[row]] !== EMPTY) {
                engine.submitTransfer(splitter.int_a[row], splitter.out_a[row], item[splitter.out_a[row]] === EMPTY, false, preferA);
                engine.submitTransfer(splitter.int_a[row], splitter.out_b[row], item[splitter.out_b[row]] === EMPTY, false, preferB);
            }
            if (item[splitter.int_b[row]] !== EMPTY) {
                engine.submitTransfer(splitter.int_b[row], splitter.out_b[row], item[splitter.out_b[row]] === EMPTY, false, preferA);
                engine.submitTransfer(splitter.int_b[row], splitter.out_a[row], item[splitter.out_a[row]] === EMPTY, false, preferB);
            }
        }
    }

    /**
     * POST_RESOLVE seam: record resolved hops, clear drained sources, then fill destinations — in
     * that order so items cross at belt speed — and advance routed splitters' round-robin state.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    _runSeam(engine) {
        const item = engine.Port.item;
        const def = engine.component("Splitter");
        const splitter = def.store;
        const stage1 = [];
        const stage2 = [];

        for (let row = 0; row < def.count; row += 1) {
            for (const intPort of [splitter.int_a[row], splitter.int_b[row]]) {
                if (item[intPort] === EMPTY) {
                    continue;
                }
                const dest = engine.resolvedDestFor(intPort);
                if (dest !== EMPTY) {
                    stage2.push({outPort: dest, item: item[intPort], intPort: intPort});
                }
            }
            for (const inPort of [splitter.in_a[row], splitter.in_b[row]]) {
                if (item[inPort] === EMPTY) {
                    continue;
                }
                const dest = engine.resolvedDestFor(inPort);
                if (dest !== EMPTY) {
                    stage1.push({intPort: dest, item: item[inPort], inPort: inPort});
                }
            }
        }

        for (const record of stage2) {
            engine.setPortItem(record.intPort, EMPTY);
        }
        for (const record of stage1) {
            engine.setPortItem(record.inPort, EMPTY);
        }
        for (const record of stage1) {
            engine.setPortItem(record.intPort, record.item);
        }
        for (const record of stage2) {
            engine.setPortItem(record.outPort, record.item);
        }

        for (let row = 0; row < def.count; row += 1) {
            if (engine.resolvedDestFor(splitter.int_a[row]) !== EMPTY || engine.resolvedDestFor(splitter.int_b[row]) !== EMPTY) {
                splitter.state[row] = 1 - splitter.state[row];
            }
        }
    }
}
