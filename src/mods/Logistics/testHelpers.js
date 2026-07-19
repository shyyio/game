// Belt-specific conveniences for specs, built on the SDK's generic TestHarness.
// They live with the mod they serve — the harness itself (`@/sdk/test.js`) stays
// content-agnostic.

import {Belts} from "./Belts.js";

/**
 * The engine's belt transport.
 * @param {GameEngine} sim
 * @returns {Belts}
 */
export function beltsOf(sim) {
    return sim.resolve(Belts);
}
