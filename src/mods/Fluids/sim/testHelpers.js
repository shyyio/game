// Pipe-specific conveniences for specs; they live with the mod they serve.

import {Pipes} from "./Pipes.js";

/**
 * The engine's pipe transport.
 * @param {GameEngine} sim
 * @returns {Pipes}
 */
export function pipesOf(sim) {
    return sim.resolve(Pipes);
}
