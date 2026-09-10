// Pipe-specific conveniences for specs; they live with the mod they serve.

import {PipeNetworkIndex} from "./PipeNetworkIndex.js";

/**
 * The engine's pipe transport.
 * @param {GameEngine} engine
 * @returns {PipeNetworkIndex}
 */
export function pipesOf(engine) {
    return engine.resolve(PipeNetworkIndex);
}
