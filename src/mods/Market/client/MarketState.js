import {AbstractCacheWriter, schemaScalar} from "@spup/sdk/client";
import {MarketSnapshotEvent} from "../common/events.js";
import {MarketSnapshotRequestMessage} from "../common/messages.js";

export const MARKET_SCHEMA = {
    // objectId of the terminal the config panel is open for, or null when closed.
    configTarget: schemaScalar(null),
    // Last MarketSnapshotEvent, or null before first response.
    snapshot: schemaScalar(null),
};

/**
 * Feeds the "market" namespace: open config panel's target object and last catalog snapshot.
 */
export class MarketWriter extends AbstractCacheWriter {

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
        if (event instanceof MarketSnapshotEvent) {
            this._state.set("market.snapshot", event);
        }
    }

    /**
     * Opens the config panel for a placed terminal and requests its current snapshot.
     * @param {number} objectId
     * @returns {void}
     */
    openConfig(objectId) {
        this._state.set("market.configTarget", objectId);
        this._state.set("market.snapshot", null);
        this._session.sendMessage(new MarketSnapshotRequestMessage(objectId));
    }

    /**
     * @returns {void}
     */
    closeConfig() {
        this._state.set("market.configTarget", null);
    }
}
