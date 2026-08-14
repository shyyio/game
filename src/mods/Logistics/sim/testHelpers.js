// Belt-specific conveniences for specs; they live with the mod they serve.

import {Belts} from "./Belts.js";

/**
 * The engine's belt transport.
 * @param {GameEngine} sim
 * @returns {Belts}
 */
export function beltsOf(sim) {
    return sim.resolve(Belts);
}
