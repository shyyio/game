import {Direction, EMPTY, NO_EID, AbstractBehavior, AbstractSystem} from "@spup/sdk";
import {SplitterComponent} from "./SplitterComponent.js";

/**
 * Ticks every splitter through the installed behavior.
 */
class SplitterSystem extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     * @param {SplitterBehavior} behavior
     */
    constructor(engine, behavior) {
        super();
        this.engine = engine;
        this.behavior = behavior;
    }

    submitIntents() {
        this.behavior._submitIntents(this.engine);
    }

    postResolve() {
        this.behavior._finish(this.engine);
    }
}

/**
 * 1x2 splitter routing in_X -> int_X -> out_Y through internal buffer ports, resting a tick per
 * hop; the round-robin state follows whichever output the resolver picked.
 */
export class SplitterBehavior extends AbstractBehavior {

    install(engine) {
        engine.components.register(new SplitterComponent());
        engine.registerSystem(new SplitterSystem(engine, this));
    }

    onSpawn(engine, eid, type, message) {
        const inA = engine.getPortAt(type.inputPorts[0], message.x, message.y, message.direction);
        const inB = engine.getPortAt(type.inputPorts[1], message.x, message.y, message.direction);
        const outA = engine.getPortAt(type.outputPorts[0], message.x, message.y, message.direction);
        const outB = engine.getPortAt(type.outputPorts[1], message.x, message.y, message.direction);
        this._wire(engine, eid, {inputPortA: inA.port, inputPortB: inB.port, outputPortA: outA.port, outputPortB: outB.port});
        engine.portItems.addOutputPort(outA.port, outA.tile.x, outA.tile.y);
        engine.portItems.addOutputPort(outB.port, outB.tile.x, outB.tile.y);
    }

    onDespawn(engine, eid) {
        const splitters = engine.components.getComponentByName("Splitter");
        const row = splitters.getRowByEid(eid);
        engine.portItems.removeOutputPort(splitters.store.outputPortA[row]);
        engine.portItems.removeOutputPort(splitters.store.outputPortB[row]);
    }

    getRenderedPortEids(engine, eid) {
        const splitters = engine.components.getComponentByName("Splitter");
        const row = splitters.getRowByEid(eid);
        return [splitters.store.outputPortA[row], splitters.store.outputPortB[row]];
    }

    resyncRenderedPorts(engine, eid) {
        const splitters = engine.components.getComponentByName("Splitter");
        const row = splitters.getRowByEid(eid);
        for (const out of [splitters.store.outputPortA[row], splitters.store.outputPortB[row]]) {
            engine.portItems.addOutputPort(out, engine.Position.x[out], engine.Position.y[out]);
        }
    }

    /**
     * Attaches the Splitter component to `eid` and wires its ports (internal ports created fresh).
     * @private
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {{inputPortA:number, inputPortB:number, outputPortA:number, outputPortB:number}} ports
     * @returns {{id:number, inputPortA:number, inputPortB:number, outputPortA:number, outputPortB:number, internalPortA:number, internalPortB:number}}
     */
    _wire(engine, eid, ports) {
        const internalPortA = engine.ports.create();
        const internalPortB = engine.ports.create();
        const splitters = engine.components.getComponentByName("Splitter");
        splitters.attach(eid);
        const splitter = splitters.store;
        const row = splitters.getRowByEid(eid);
        splitter.inputPortA[row] = ports.inputPortA;
        splitter.inputPortB[row] = ports.inputPortB;
        splitter.outputPortA[row] = ports.outputPortA;
        splitter.outputPortB[row] = ports.outputPortB;
        splitter.internalPortA[row] = internalPortA;
        splitter.internalPortB[row] = internalPortB;
        splitter.state[row] = 0;
        return {id: eid, inputPortA: ports.inputPortA, inputPortB: ports.inputPortB, outputPortA: ports.outputPortA, outputPortB: ports.outputPortB, internalPortA, internalPortB};
    }

    /**
     * Creates a sim-only splitter for specs and debugging; ports fresh unless given in `wiring`.
     * @param {GameEngine} engine
     * @param {{inputPortA?:number, inputPortB?:number, outputPortA?:number, outputPortB?:number}} [wiring]
     * @returns {{id:number, inputPortA:number, inputPortB:number, outputPortA:number, outputPortB:number, internalPortA:number, internalPortB:number}}
     */
    addSplitter(engine, wiring={}) {
        const port = given => given === undefined ? engine.ports.create() : given;
        // Ports first so their eids stay contiguous from 1.
        const ports = {
            inputPortA: port(wiring.inputPortA),
            inputPortB: port(wiring.inputPortB),
            outputPortA: port(wiring.outputPortA),
            outputPortB: port(wiring.outputPortB),
        };
        const eid = engine.components.getComponentByName("Splitter").create();
        return this._wire(engine, eid, ports);
    }

    /**
     * Places a sim-only UP-facing splitter at (x, y) adopting adjacent belts' edge ports; for specs and debugging.
     * @param {GameEngine} engine
     * @param {number} x
     * @param {number} y
     * @returns {{id:number, inputPortA:number, inputPortB:number, outputPortA:number, outputPortB:number, internalPortA:number, internalPortB:number}}
     */
    placeSplitter(engine, x, y) {
        return this.addSplitter(engine, {
            inputPortA: engine.ports.getPortEidAt(x, y, Direction.UP),
            inputPortB: engine.ports.getPortEidAt(x + 1, y, Direction.UP),
            outputPortA: engine.ports.getPortEidAt(x, y - 1, Direction.UP),
            outputPortB: engine.ports.getPortEidAt(x + 1, y - 1, Direction.UP),
        });
    }

    /**
     * Submits each loaded input to its internal port, and each loaded internal port fanned out to
     * both outputs ranked by the round-robin state.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    _submitIntents(engine) {
        const item = engine.Port.item;
        const splitters = engine.components.getComponentByName("Splitter");
        const splitter = splitters.store;
        for (let row = 0; row < splitters.count; row += 1) {
            if (item[splitter.inputPortA[row]] !== EMPTY) {
                engine.transfers.submitTransfer(splitter.inputPortA[row], splitter.internalPortA[row], item[splitter.internalPortA[row]] === EMPTY);
            }
            if (item[splitter.inputPortB[row]] !== EMPTY) {
                engine.transfers.submitTransfer(splitter.inputPortB[row], splitter.internalPortB[row], item[splitter.internalPortB[row]] === EMPTY);
            }
            const preferA = splitter.state[row] === 0 ? 1 : 2;
            const preferB = splitter.state[row] === 0 ? 2 : 1;
            if (item[splitter.internalPortA[row]] !== EMPTY) {
                engine.transfers.submitTransfer(splitter.internalPortA[row], splitter.outputPortA[row], item[splitter.outputPortA[row]] === EMPTY, preferA);
                engine.transfers.submitTransfer(splitter.internalPortA[row], splitter.outputPortB[row], item[splitter.outputPortB[row]] === EMPTY, preferB);
            }
            if (item[splitter.internalPortB[row]] !== EMPTY) {
                engine.transfers.submitTransfer(splitter.internalPortB[row], splitter.outputPortB[row], item[splitter.outputPortB[row]] === EMPTY, preferA);
                engine.transfers.submitTransfer(splitter.internalPortB[row], splitter.outputPortA[row], item[splitter.outputPortA[row]] === EMPTY, preferB);
            }
        }
    }

    /**
     * POST_RESOLVE: a splitter that routed an internal port this tick flips its round-robin state.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    _finish(engine) {
        const splitters = engine.components.getComponentByName("Splitter");
        const splitter = splitters.store;
        for (let row = 0; row < splitters.count; row += 1) {
            if (engine.transfers.getDestByPortEid(splitter.internalPortA[row]) !== EMPTY || engine.transfers.getDestByPortEid(splitter.internalPortB[row]) !== EMPTY) {
                splitter.state[row] = 1 - splitter.state[row];
            }
        }
    }
}
