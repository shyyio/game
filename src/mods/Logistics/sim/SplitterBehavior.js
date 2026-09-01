import {Direction, EMPTY, NO_EID, TickPhase, AbstractBehavior} from "@spup/sdk";
import {ORDER_BEFORE_TRANSPORT} from "../common/constants.js";

/**
 * 1x2 splitter routing in_X -> int_X -> out_Y through internal buffer ports, resting a tick per
 * hop, submitting managed=0 intents so the resolver only links and the seam does the moves.
 */
export class SplitterBehavior extends AbstractBehavior {

    install(engine) {
        engine.components.define("Splitter", [
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
        const outputFills = [];
        engine.registerSystem(TickPhase.POST_RESOLVE, () => this._runSeam(engine, outputFills), ORDER_BEFORE_TRANSPORT);
        // Out-ports fill after the transport ingested, so a routed item rests a tick in its out-port.
        engine.registerSystem(TickPhase.PRODUCE_OUTPUTS, () => this._fillOutputs(engine, outputFills));
    }

    onSpawn(engine, eid, type, message) {
        const inA = engine.portFor(type.inputPorts[0], message.x, message.y, message.direction);
        const inB = engine.portFor(type.inputPorts[1], message.x, message.y, message.direction);
        const outA = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        const outB = engine.portFor(type.outputPorts[1], message.x, message.y, message.direction);
        this._wire(engine, eid, {in_a: inA.port, in_b: inB.port, out_a: outA.port, out_b: outB.port});
        engine.render.registerPort(outA.port, outA.tile.x, outA.tile.y);
        engine.render.registerPort(outB.port, outB.tile.x, outB.tile.y);
    }

    onDespawn(engine, eid) {
        const def = engine.components.get("Splitter");
        const row = def.row(eid);
        engine.render.unregisterPort(def.store.out_a[row]);
        engine.render.unregisterPort(def.store.out_b[row]);
    }

    syncData(engine, eid) {
        const def = engine.components.get("Splitter");
        const row = def.row(eid);
        return {portIds: [def.store.out_a[row], def.store.out_b[row]], lastOutput: null};
    }

    resyncRenderedPorts(engine, eid) {
        const def = engine.components.get("Splitter");
        const row = def.row(eid);
        for (const out of [def.store.out_a[row], def.store.out_b[row]]) {
            engine.render.registerPort(out, engine.Position.x[out], engine.Position.y[out]);
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
        const int_a = engine.ports.create();
        const int_b = engine.ports.create();
        const def = engine.components.get("Splitter");
        engine.components.attach(def, eid);
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
        const port = given => given === undefined ? engine.ports.create() : given;
        // Ports first so their eids stay contiguous from 1.
        const ports = {
            in_a: port(wiring.in_a),
            in_b: port(wiring.in_b),
            out_a: port(wiring.out_a),
            out_b: port(wiring.out_b),
        };
        const eid = engine.components.createEntity(engine.components.get("Splitter"));
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
            in_a: engine.ports.at(x, y, Direction.UP),
            in_b: engine.ports.at(x + 1, y, Direction.UP),
            out_a: engine.ports.at(x, y - 1, Direction.UP),
            out_b: engine.ports.at(x + 1, y - 1, Direction.UP),
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
        const def = engine.components.get("Splitter");
        const splitter = def.store;
        for (let row = 0; row < def.count; row += 1) {
            if (item[splitter.in_a[row]] !== EMPTY) {
                engine.transfers.submitTransfer(splitter.in_a[row], splitter.int_a[row], item[splitter.int_a[row]] === EMPTY, false);
            }
            if (item[splitter.in_b[row]] !== EMPTY) {
                engine.transfers.submitTransfer(splitter.in_b[row], splitter.int_b[row], item[splitter.int_b[row]] === EMPTY, false);
            }
            const preferA = splitter.state[row] === 0 ? 1 : 2;
            const preferB = splitter.state[row] === 0 ? 2 : 1;
            if (item[splitter.int_a[row]] !== EMPTY) {
                engine.transfers.submitTransfer(splitter.int_a[row], splitter.out_a[row], item[splitter.out_a[row]] === EMPTY, false, preferA);
                engine.transfers.submitTransfer(splitter.int_a[row], splitter.out_b[row], item[splitter.out_b[row]] === EMPTY, false, preferB);
            }
            if (item[splitter.int_b[row]] !== EMPTY) {
                engine.transfers.submitTransfer(splitter.int_b[row], splitter.out_b[row], item[splitter.out_b[row]] === EMPTY, false, preferA);
                engine.transfers.submitTransfer(splitter.int_b[row], splitter.out_a[row], item[splitter.out_a[row]] === EMPTY, false, preferB);
            }
        }
    }

    /**
     * POST_RESOLVE seam: record resolved hops, clear drained sources, fill the internal ports, and
     * advance routed splitters' round-robin state; out-port fills defer to PRODUCE_OUTPUTS.
     * @private
     * @param {GameEngine} engine
     * @param {{outPort:number, item:number}[]} outputFills
     * @returns {void}
     */
    _runSeam(engine, outputFills) {
        const item = engine.Port.item;
        const def = engine.components.get("Splitter");
        const splitter = def.store;
        const stage1 = [];
        const stage2 = [];

        for (let row = 0; row < def.count; row += 1) {
            for (const intPort of [splitter.int_a[row], splitter.int_b[row]]) {
                if (item[intPort] === EMPTY) {
                    continue;
                }
                const dest = engine.transfers.destFor(intPort);
                if (dest !== EMPTY) {
                    stage2.push({outPort: dest, item: item[intPort], intPort: intPort});
                }
            }
            for (const inPort of [splitter.in_a[row], splitter.in_b[row]]) {
                if (item[inPort] === EMPTY) {
                    continue;
                }
                const dest = engine.transfers.destFor(inPort);
                if (dest !== EMPTY) {
                    stage1.push({intPort: dest, item: item[inPort], inPort: inPort});
                }
            }
        }

        for (const record of stage2) {
            engine.ports.setItem(record.intPort, EMPTY);
        }
        for (const record of stage1) {
            engine.ports.consumeItem(record.inPort);
        }
        for (const record of stage1) {
            engine.ports.setItem(record.intPort, record.item);
        }
        for (const record of stage2) {
            outputFills.push(record);
        }

        for (let row = 0; row < def.count; row += 1) {
            if (engine.transfers.destFor(splitter.int_a[row]) !== EMPTY || engine.transfers.destFor(splitter.int_b[row]) !== EMPTY) {
                splitter.state[row] = 1 - splitter.state[row];
            }
        }
    }

    /**
     * PRODUCE_OUTPUTS: writes the seam's routed items into their out-ports, after the transport
     * ingested this tick — so each item rests a visible tick in its out-port.
     * @private
     * @param {GameEngine} engine
     * @param {{outPort:number, item:number}[]} outputFills
     * @returns {void}
     */
    _fillOutputs(engine, outputFills) {
        for (const record of outputFills) {
            engine.ports.setItem(record.outPort, record.item);
        }
        outputFills.length = 0;
    }
}
