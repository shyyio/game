import {setupGame} from "@/sdk/test.js";
import {BeltMod} from "@/mods/Belt/mod.js";
import {DemoMod} from "@/mods/DemoMod/DemoMod.js";

/**
 * Boots a TestHarness with this repo's content mods loaded (Belt, which also provides the
 * Splitter, and DemoMod), matching what Game.vue loads.
 * @returns {Promise<TestHarness>}
 */
export async function setup() {
    return setupGame([
        new BeltMod(),
        new DemoMod(),
    ]);
}
