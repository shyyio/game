import {AbstractCacheWriter, schemaMap, schemaScalar} from "@spup/sdk/client";
import {
    GateSetEvent,
    ControlLinkSetEvent,
    ControlLinkClearEvent,
    ControlSnapshotEvent,
} from "../common/events.js";
import {SetGateOpenMessage, ControlSnapshotRequestMessage} from "../common/messages.js";

export const LOGISTICS_SCHEMA = {
    // Gate objectId -> open (1/0); absent means open (only off-default gates sync).
    openById: schemaMap(),
    // Gate objectId -> mode (1 fluid, 0 item); absent means item.
    fluidById: schemaMap(),
    // Device objectId -> wired pole objectId; absent means unwired.
    linkPoleById: schemaMap(),
    // objectId of the terminal the config panel is open for, or null when closed.
    configTarget: schemaScalar(null),
    // Last ControlSnapshotEvent, or null before first response.
    controlSnapshot: schemaScalar(null),
};

/**
 * Feeds the "logistics" namespace: gate states and device wires.
 */
export class LogisticsWriter extends AbstractCacheWriter {

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
            return;
        }
        if (event instanceof ControlLinkSetEvent) {
            this._state.mapSet("logistics.linkPoleById", event.deviceObjectId, event.poleObjectId);
            return;
        }
        if (event instanceof ControlLinkClearEvent) {
            this._state.mapDelete("logistics.linkPoleById", event.deviceObjectId);
            return;
        }
        if (event instanceof ControlSnapshotEvent && event.objectId === this._state.get("logistics.configTarget")) {
            this._state.set("logistics.controlSnapshot", event);
        }
    }

    /**
     * Opens the config panel for a placed terminal and requests its network snapshot.
     * @param {number} objectId
     * @returns {void}
     */
    openTerminalConfig(objectId) {
        this._state.set("logistics.configTarget", objectId);
        this._state.set("logistics.controlSnapshot", null);
        this._session.sendMessage(new ControlSnapshotRequestMessage(objectId));
    }

    /**
     * @returns {void}
     */
    closeTerminalConfig() {
        this._state.set("logistics.configTarget", null);
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

    /**
     * Drops a removed device's wire.
     * @param {number} objectId
     * @returns {void}
     */
    forgetLink(objectId) {
        this._state.mapDelete("logistics.linkPoleById", objectId);
    }
}
