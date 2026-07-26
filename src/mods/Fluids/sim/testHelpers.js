// Pipe-specific conveniences for specs, mirroring Logistics' testHelpers.

import {GameEngine} from "@/sim/GameEngine.js";
import {Pipes} from "./Pipes.js";

/**
 * A bare engine with a Pipes module, for network-level specs.
 * @returns {Promise<{engine: GameEngine, pipes: Pipes}>}
 */
export async function makePipes() {
    const engine = new GameEngine();
    await engine.init();
    return {engine, pipes: new Pipes(engine)};
}

/**
 * The engine's pipe transport.
 * @param {GameEngine} sim
 * @returns {Pipes}
 */
export function pipesOf(sim) {
    return sim.resolve(Pipes);
}
