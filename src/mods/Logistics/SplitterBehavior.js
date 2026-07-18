import {Direction, EMPTY, NO_EID, TickPhase, AbstractBehavior} from "@/sdk/common.js";
import {ORDER_BEFORE_TRANSPORT} from "./constants.js";

/**
 * The splitter's sim behavior: a 1x2 router of two inputs and two outputs (ports shared with
 * adjacent belts) through two internal buffer ports. Each item flows in_X -> int_X -> out_Y, resting
 * a tick in int_X (belt speed). Submits managed=0 intents so the shared resolver only links the
 * chain; the POST_RESOLVE seam does the moves. All state lives in the registered component, so it
 * serializes with no bespoke save code.
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
        ]);
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._submitIntents(engine));
        // The seam must read shared ports before the belt transport writes pops, whatever the
        // registration sequence.
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
        return [outA.port, outB.port];
    }

    onDespawn(engine, placed, eid) {
        const splitter = engine.component("Splitter").store;
        engine.unregisterRenderedPort(splitter.out_a[eid]);
        engine.unregisterRenderedPort(splitter.out_b[eid]);
    }

    syncData(engine, placed, eid) {
        const splitter = engine.component("Splitter").store;
        return {portIds: [splitter.out_a[eid], splitter.out_b[eid]], lastOutput: null};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const splitter = engine.component("Splitter").store;
        [splitter.out_a[eid], splitter.out_b[eid]].forEach(out => {
            engine.registerRenderedPort(out, engine.Position.x[out], engine.Position.y[out]);
        });
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
        engine.attachComponent(engine.component("Splitter"), eid);
        const splitter = engine.component("Splitter").store;
        splitter.in_a[eid] = ports.in_a;
        splitter.in_b[eid] = ports.in_b;
        splitter.out_a[eid] = ports.out_a;
        splitter.out_b[eid] = ports.out_b;
        splitter.int_a[eid] = int_a;
        splitter.int_b[eid] = int_b;
        splitter.state[eid] = 0;
        return {id: eid, in_a: ports.in_a, in_b: ports.in_b, out_a: ports.out_a, out_b: ports.out_b, int_a, int_b};
    }

    /**
     * Creates a sim-only splitter (no PlacedObject entity), state 0. Ports are fresh unless given in
     * `wiring` (e.g. an upstream belt's out-port reused as in_a). For specs and debugging.
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
     * Places a sim-only UP-facing 1x2 splitter at (x, y), adopting the shared edge ports of adjacent
     * belts: in_a/in_b feed from below (the belts at (x,y)/(x+1,y)), out_a/out_b feed the belts above
     * (x,y-1)/(x+1,y-1). Internal ports are private. For specs and debugging.
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
     * Stage 1: buffer each loaded input into its internal port (single destination). Stage 2: route
     * each loaded internal port to both outputs as competing fan-out intents, ranked by the
     * round-robin state. All managed=0 — the seam does the moves.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    _submitIntents(engine) {
        const item = engine.Port.item;
        const def = engine.component("Splitter");
        const splitter = def.store;
        engine.entitiesWith(def).forEach(eid => {
            if (item[splitter.in_a[eid]] !== EMPTY) {
                engine.submitIntent({source: splitter.in_a[eid], dest: splitter.int_a[eid], destEmpty: item[splitter.int_a[eid]] === EMPTY, managed: false});
            }
            if (item[splitter.in_b[eid]] !== EMPTY) {
                engine.submitIntent({source: splitter.in_b[eid], dest: splitter.int_b[eid], destEmpty: item[splitter.int_b[eid]] === EMPTY, managed: false});
            }
            const preferA = splitter.state[eid] === 0 ? 1 : 2;
            const preferB = splitter.state[eid] === 0 ? 2 : 1;
            if (item[splitter.int_a[eid]] !== EMPTY) {
                engine.submitIntent({source: splitter.int_a[eid], dest: splitter.out_a[eid], destEmpty: item[splitter.out_a[eid]] === EMPTY, managed: false, rank: preferA});
                engine.submitIntent({source: splitter.int_a[eid], dest: splitter.out_b[eid], destEmpty: item[splitter.out_b[eid]] === EMPTY, managed: false, rank: preferB});
            }
            if (item[splitter.int_b[eid]] !== EMPTY) {
                engine.submitIntent({source: splitter.int_b[eid], dest: splitter.out_b[eid], destEmpty: item[splitter.out_b[eid]] === EMPTY, managed: false, rank: preferA});
                engine.submitIntent({source: splitter.int_b[eid], dest: splitter.out_a[eid], destEmpty: item[splitter.out_a[eid]] === EMPTY, managed: false, rank: preferB});
            }
        });
    }

    /**
     * The POST_RESOLVE seam: record each resolved int->out and in->int hop and its item, clear the
     * drained sources, buffer inputs into internal ports, then write internal ports out — record,
     * clear, fill in that order so items cross at belt speed. Finally advance the round-robin state of
     * every splitter that routed an item.
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

        engine.entitiesWith(def).forEach(eid => {
            [splitter.int_a[eid], splitter.int_b[eid]].forEach(intPort => {
                if (item[intPort] === EMPTY) {
                    return;
                }
                const dest = engine.resolvedDestFor(intPort);
                if (dest !== EMPTY) {
                    stage2.push({outPort: dest, item: item[intPort], intPort: intPort});
                }
            });
            [splitter.in_a[eid], splitter.in_b[eid]].forEach(inPort => {
                if (item[inPort] === EMPTY) {
                    return;
                }
                const dest = engine.resolvedDestFor(inPort);
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

        engine.entitiesWith(def).forEach(eid => {
            if (engine.resolvedDestFor(splitter.int_a[eid]) !== EMPTY || engine.resolvedDestFor(splitter.int_b[eid]) !== EMPTY) {
                splitter.state[eid] = 1 - splitter.state[eid];
            }
        });
    }
}
