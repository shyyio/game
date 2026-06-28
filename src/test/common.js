import {setupGame} from "@/sdk/test.js";
import {BeltMod} from "@/mods/Belt/mod.js";

/**
 * Boots a TestHarness with this repo's content mods loaded (the Belt mod, which now
 * also provides the Splitter).
 * @returns {Promise<TestHarness>}
 */
export async function setup() {
    return setupGame([
        new BeltMod(),
    ]);
}
