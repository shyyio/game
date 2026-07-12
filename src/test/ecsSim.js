import {ModRegistry} from "@/common/ModRegistry.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {DemoMod} from "@/mods/DemoMod/DemoMod.js";
import {ResourcesMod} from "@/mods/Resources/Resources.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";

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
 * A booted EcsSimEngine with the standard content mods registered.
 * @returns {Promise<EcsSimEngine>}
 */
export async function makeEcsSimEngine() {
    const engine = new EcsSimEngine(ecsModRegistry());
    await engine.init();
    return engine;
}
