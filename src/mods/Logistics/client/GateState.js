import {AbstractCacheWriter, schemaMap} from "@spup/sdk/client";
import {GateSetEvent} from "../common/events.js";
import {SetGateOpenMessage} from "../common/messages.js";

export const LOGISTICS_SCHEMA = {
    // Gate objectId -> open (1/0); absent means open (only off-default gates sync).
    openById: schemaMap(),
    // Gate objectId -> mode (1 fluid, 0 item); absent means item.
    fluidById: schemaMap(),
};

/**
 * Feeds the "logistics" namespace: gate open states.
 */
export class GatesWriter extends AbstractCacheWriter {

    /**
     * @param {ClientCache} state
     * @param {AbstractSession} session
     */
    constructor(state, session) {
        super(state);
        this._session = session;
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof GateSetEvent) {
            this._state.mapSet("logistics.openById", event.objectId, event.open);
            this._state.mapSet("logistics.fluidById", event.objectId, event.fluid);
        }
    }

    /**
     * Requests the inverse of a gate's cached open state, flipping optimistically.
     * @param {number} objectId
     * @returns {void}
     */
    toggleGate(objectId) {
        const open = this._state.mapGet("logistics.openById", objectId);
        const next = open === 0 ? 1 : 0;
        this._state.mapSet("logistics.openById", objectId, next);
        this._session.sendMessage(new SetGateOpenMessage(objectId, next));
    }

    /**
     * Applies a client-side mode prediction ahead of the sim's confirming delta.
     * @param {number} objectId
     * @param {number} fluid - 1 fluid mode, 0 item mode
     * @returns {void}
     */
    predictFluid(objectId, fluid) {
        this._state.mapSet("logistics.fluidById", objectId, fluid);
    }

    /**
     * Drops a removed gate's state.
     * @param {number} objectId
     * @returns {void}
     */
    forget(objectId) {
        this._state.mapDelete("logistics.openById", objectId);
        this._state.mapDelete("logistics.fluidById", objectId);
    }
}
