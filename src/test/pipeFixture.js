import {GameEngine} from "@/sim/GameEngine.js";
import {Pipes} from "@/mods/Fluids/sim/Pipes.js";

/**
 * A bare engine with a Pipes module, for network-level specs.
 * @returns {Promise<{engine: GameEngine, pipes: Pipes}>}
 */
export async function makePipes() {
    const engine = new GameEngine();
    await engine.init();
    return {engine, pipes: new Pipes(engine)};
}
