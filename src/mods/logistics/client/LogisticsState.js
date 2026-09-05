import {AbstractCacheWriter, schemaMap, schemaScalar} from "@spup/sdk/client";
import {GateSetEvent, LogicSnapshotEvent} from "../common/events.js";
import {
    SetGateOpenMessage,
    LogicSnapshotRequestMessage,
    ConfigureLogicRulesMessage,
} from "../common/messages.js";

export const LOGISTICS_SCHEMA = {
    // Gate objectId -> open (1/0); absent means open (only off-default gates sync).
    openById: schemaMap(),
    // Gate objectId -> mode (1 fluid, 0 item); absent means item.
    fluidById: schemaMap(),
    // objectId of the terminal the config panel is open for, or null when closed.
    configTarget: schemaScalar(null),
    // Last LogicSnapshotEvent, or null before first response.
    logicSnapshot: schemaScalar(null),
};

/**
 * Feeds the "logistics" namespace: gate states and the terminal config panel.
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
        if (event instanceof LogicSnapshotEvent && event.objectId === this._state.get("logistics.configTarget")) {
            this._state.set("logistics.logicSnapshot", event);
        }
    }

    /**
     * Opens the config panel for a placed terminal and requests its network snapshot.
     * @param {number} objectId
     * @returns {void}
     */
    openTerminalConfig(objectId) {
        this._state.set("logistics.configTarget", objectId);
        this._state.set("logistics.logicSnapshot", null);
        this._session.sendMessage(new LogicSnapshotRequestMessage(objectId));
    }

    /**
     * @returns {void}
     */
    closeTerminalConfig() {
        this._state.set("logistics.configTarget", null);
    }

    /**
     * Replaces a terminal's whole rule list, then refreshes the snapshot the panel renders from.
     * @param {number} objectId
     * @param {LogicRule[]} rules
     * @returns {void}
     */
    configureLogicRules(objectId, rules) {
        const conditions = rules.flatMap(rule => rule.conditions);
        this._session.sendMessage(new ConfigureLogicRulesMessage(
            objectId,
            rules.map(rule => rule.actionDeviceId),
            rules.map(rule => rule.actionKey),
            rules.map(rule => rule.actionValue),
            rules.map(rule => rule.conditions.length),
            conditions.map(condition => condition.kind),
            conditions.map(condition => condition.deviceId),
            conditions.map(condition => condition.itemType),
            conditions.map(condition => condition.key),
            conditions.map(condition => condition.comparator),
            conditions.map(condition => condition.value),
        ));
        this._session.sendMessage(new LogicSnapshotRequestMessage(objectId));
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
