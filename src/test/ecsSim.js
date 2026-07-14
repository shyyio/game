import {ModRegistry} from "@/common/ModRegistry.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {DemoMod} from "@/mods/DemoMod/DemoMod.js";
import {ResourcesMod} from "@/mods/Resources/Resources.js";
import {GameEngine} from "@/common/sim/GameEngine.js";

/**
 * A ModRegistry with the standard content mods loaded and typeIds assigned (accessing `definitions`),
 * for tests that need the bitECS engine or the definitions' typeIds.
 * @returns {ModRegistry}
 */
export function ecsModRegistry() {
    const modRegistry = new ModRegistry();
    modRegistry.loadMod(new LogisticsMod());
    modRegistry.loadMod(new DemoMod());
    modRegistry.loadMod(new ResourcesMod());
    modRegistry.definitions;
    return modRegistry;
}

/**
 * A booted GameEngine with the standard content mods registered.
 * @returns {Promise<GameEngine>}
 */
export async function makeGameEngine() {
    const engine = new GameEngine(ecsModRegistry());
    await engine.init();
    return engine;
}
