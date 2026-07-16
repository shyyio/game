import {ModRegistry} from "@/common/mod/ModRegistry.js";
import {simLoadout} from "@/mods/loadout.js";
import {GameEngine} from "@/common/sim/GameEngine.js";

/**
 * A frozen ModRegistry with the standard sim loadout (typeIds assigned), for tests that need the
 * bitECS engine or the definitions' typeIds.
 * @returns {ModRegistry}
 */
export function ecsModRegistry() {
    const modRegistry = new ModRegistry();
    simLoadout().forEach(pkg => modRegistry.register(pkg));
    modRegistry.freeze();
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
