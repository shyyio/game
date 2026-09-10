import {AbstractCacheWriter, schemaScalar} from "@spup/sdk/client";
import {LogicSnapshotEvent} from "../common/events.js";
import {
    SetGateOpenMessage,
    LogicSnapshotRequestMessage,
    ConfigureLogicRulesMessage,
} from "../common/messages.js";

export const LOGISTICS_SCHEMA = {
    // objectRef of the terminal the config panel is open for, or null when closed.
    configTarget: schemaScalar(null),
    // Last LogicSnapshotEvent, or null before first response.
    logicSnapshot: schemaScalar(null),
};

/**
 * Feeds the "logistics" namespace: the terminal config panel, plus the gate's optimistic patches
 * onto the shared object entries.
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
        if (event instanceof LogicSnapshotEvent && event.objectRef === this._state.get("logistics.configTarget")) {
            this._state.set("logistics.logicSnapshot", event);
        }
    }

    /**
     * Opens the config panel for a placed terminal and requests its network snapshot.
     * @param {number} objectRef
     * @returns {void}
     */
    openTerminalConfig(objectRef) {
        this._state.set("logistics.configTarget", objectRef);
        this._state.set("logistics.logicSnapshot", null);
        this._session.sendMessage(new LogicSnapshotRequestMessage(objectRef));
    }

    /**
     * @returns {void}
     */
    closeTerminalConfig() {
        this._state.set("logistics.configTarget", null);
    }

    /**
     * Replaces a terminal's whole rule list, then refreshes the snapshot the panel renders from.
     * @param {number} objectRef
     * @param {LogicRule[]} rules
     * @returns {void}
     */
    configureLogicRules(objectRef, rules) {
        const conditions = rules.flatMap(rule => rule.conditions);
        this._session.sendMessage(new ConfigureLogicRulesMessage(
            objectRef,
            rules.map(rule => rule.actionDeviceId),
            rules.map(rule => rule.actionKey),
            rules.map(rule => rule.actionValue),
            rules.map(rule => rule.conditions.length),
            conditions.map(condition => condition.kind),
            conditions.map(condition => condition.deviceId),
            conditions.map(condition => condition.itemTypeId),
            conditions.map(condition => condition.key),
            conditions.map(condition => condition.comparator),
            conditions.map(condition => condition.value),
        ));
        this._session.sendMessage(new LogicSnapshotRequestMessage(objectRef));
    }

    /**
     * Requests the inverse of a gate's synced open state, flipping optimistically.
     * @param {number} objectRef
     * @returns {void}
     */
    toggleGate(objectRef) {
        const objects = this._state.view("objects");
        const next = objects.get(objectRef).data.open === 0 ? 1 : 0;
        objects.apply(objectRef, {open: next});
        this._session.sendMessage(new SetGateOpenMessage(objectRef, next === 1));
    }
}
