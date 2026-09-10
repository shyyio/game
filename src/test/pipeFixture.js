import {GameEngine} from "@/sim/GameEngine.js";
import {PipeNetworkIndex} from "@/mods/fluids/sim/PipeNetworkIndex.js";

/**
 * A bare engine with a Pipes module, for network-level specs.
 * @returns {Promise<{engine: GameEngine, pipes: PipeNetworkIndex}>}
 */
export async function makePipes() {
    const engine = new GameEngine();
    await engine.init();
    return {engine, pipes: new PipeNetworkIndex(engine)};
}
