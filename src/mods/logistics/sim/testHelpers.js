// Belt-specific conveniences for specs; they live with the mod they serve.

import {Belts} from "./Belts.js";

/**
 * The engine's belt transport.
 * @param {GameEngine} engine
 * @returns {Belts}
 */
export function beltsOf(engine) {
    return engine.resolve(Belts);
}
