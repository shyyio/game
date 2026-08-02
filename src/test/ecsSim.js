import {ModRegistry} from "@/common/ModRegistry.js";
import {simLoadout} from "@/mods/loadout.js";
import {GameEngine} from "@/sim/GameEngine.js";

/**
 * A frozen ModRegistry with the standard sim loadout (typeIds assigned), for tests that need the
 * ECS engine or the definitions' typeIds.
 * @param {ModPackage[]} [extraPackages] registered after the standard loadout, for tests that need
 *     a fixture-only declaration (e.g. a market listing) without touching real mod content
 * @returns {ModRegistry}
 */
export function ecsModRegistry(extraPackages = []) {
    const modRegistry = new ModRegistry();
    for (const pkg of simLoadout()) {
        modRegistry.register(pkg);
    }
    for (const pkg of extraPackages) {
        modRegistry.register(pkg);
    }
    modRegistry.freeze();
    return modRegistry;
}

/**
 * A booted GameEngine with the standard content mods registered.
 * @param {ModPackage[]} [extraPackages] see ecsModRegistry
 * @returns {Promise<GameEngine>}
 */
export async function makeGameEngine(extraPackages = []) {
    const engine = new GameEngine(ecsModRegistry(extraPackages));
    await engine.init();
    return engine;
}
