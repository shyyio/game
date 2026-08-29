// Pipe-specific conveniences for specs; they live with the mod they serve.

import {Pipes} from "./Pipes.js";

/**
 * The engine's pipe transport.
 * @param {GameEngine} engine
 * @returns {Pipes}
 */
export function pipesOf(engine) {
    return engine.resolve(Pipes);
}
