import {NotImplementedError} from "@/common/error.js";

/**
 * The optional sim part of a mod: bespoke ECS content registered on the engine. A sim mod defines
 * components (sim.defineComponent), registers per-phase systems (sim.registerSystem), and handles
 * its spawn/despawn messages (sim.registerMessageHandler) plus chunk sync and inspection.
 */
export class AbstractSimMod {

    /**
     * Registers this mod's ECS content on the engine.
     * @param {GameEngine} sim
     * @returns {void}
     */
    setup(sim) {
        throw new NotImplementedError();
    }
}
