import {ModRegistry} from "@/common/ModRegistry.js";
import {simLoadout} from "@/mods/loadout.js";
import {Game} from "@/sim/Game.js";
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

/**
 * A booted Game over the standard loadout, for specs that drive it through sessions and messages.
 * @param {ModPackage[]} [extraPackages] see ecsModRegistry
 * @param {AbstractSaveStore} [saveStore] for specs that save and reload
 * @returns {Promise<Game>}
 */
export async function makeGame(extraPackages = [], saveStore = undefined) {
    const modRegistry = ecsModRegistry(extraPackages);
    const game = new Game(modRegistry, new GameEngine(modRegistry), saveStore);
    await game.init();
    return game;
}
