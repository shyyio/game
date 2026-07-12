import {NotImplementedError} from "@/common/error.js";
import {TickPhase} from "@/common/core.js";

// The tick phases run in order each whole tick, mirroring the SQL pipeline.
export const TICK_PHASE_ORDER = [
    TickPhase.SUBMIT_INTENTS,
    TickPhase.RESOLVE_TRANSFERS,
    TickPhase.CONSUME_INPUTS,
    TickPhase.POST_RESOLVE,
    TickPhase.PRODUCE_OUTPUTS,
    TickPhase.COMMIT_TRANSFERS,
    TickPhase.EMIT_RENDER,
    TickPhase.EMIT_INSPECT,
];

/**
 * The runtime simulation contract Game drives, independent of backend. Both the legacy SqlEngine
 * (SQLite) and the new EcsEngine (bitECS) implement it, so a scenario can run against either for
 * differential parity testing.
 * @abstract
 */
export class SimEngine {

    /**
     * @abstract
     * @returns {Promise<void>}
     */
    async init() {
        throw new NotImplementedError();
    }

    /**
     * Runs every system registered for one phase, in registration order.
     * @abstract
     * @param {TickPhase} phase
     * @returns {void}
     */
    tick(phase) {
        throw new NotImplementedError();
    }

    /**
     * Runs a whole tick (every phase in order).
     * @returns {void}
     */
    tickAll() {
        TICK_PHASE_ORDER.forEach(phase => {
            this.tick(phase);
        });
    }

    /**
     * Applies a player message to the simulation. The default handles none (the legacy SQL path
     * dispatches messages through the mods instead); the bitECS engine overrides this.
     * @param {AbstractMessage} message
     * @returns {boolean} whether the engine handled it
     */
    applyMessage(message) {
        return false;
    }

    /**
     * The events recreating this engine's objects/items in `chunk`, sent when a session subscribes.
     * The default is none (the legacy SQL path uses the mods' collectChunkSync); the bitECS engine
     * overrides this.
     * @param {number} chunk
     * @returns {object[]}
     */
    chunkSync(chunk) {
        return [];
    }

    /**
     * Drains this engine's domain events (placement/path/delete + render deltas), for the owner to
     * broadcast by chunk.
     * @returns {AbstractEvent[]}
     */
    drainEvents() {
        return [];
    }

    /**
     * The current inspect snapshot for an object, or null if unknown. The bitECS engine overrides.
     * @param {number} objectId
     * @returns {object|null}
     */
    inspectSnapshot(objectId) {
        return null;
    }

    /**
     * Debug helper: drops an item onto the lowest belt path's in-port. No-op by default.
     * @returns {void}
     */
    debugInsertItem() {
    }
}
