
import {setupGame} from "@/sdk/test.js";
import {BeltMod} from "@/mods/Belt/mod.js";
import {SplitterMod} from "@/mods/Splitter/mod.js";

/**
 * Boots a TestHarness with this repo's content mods (Belt, Splitter) loaded.
 * Mod-specific test helpers (e.g. createBelt) live with their mod; this only
 * fixes the mod list the repo's specs run against.
 * @returns {Promise<TestHarness>}
 */
export async function setup() {
    return setupGame([new BeltMod(), new SplitterMod()]);
}
