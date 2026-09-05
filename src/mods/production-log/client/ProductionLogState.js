import {AbstractCacheWriter, schemaScalar} from "@spup/sdk/client";
import {ProductionLogEvent, ItemLeaderboardEvent} from "../common/events.js";
import {
    ProductionLogRequestMessage,
    ItemLeaderboardRequestMessage,
} from "../common/messages.js";

export const PRODUCTION_LOG_SCHEMA = {
    // Last ProductionLogEvent, or null before the first answer.
    log: schemaScalar(null),
    // Last ItemLeaderboardEvent, or null before the first answer.
    itemBoard: schemaScalar(null),
};

/**
 * Feeds the "productionLog" namespace: the last log and leaderboard answers, requested here.
 */
export class ProductionLogWriter extends AbstractCacheWriter {

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
        if (event instanceof ProductionLogEvent) {
            this._state.set("productionLog.log", event);
        }
        if (event instanceof ItemLeaderboardEvent) {
            this._state.set("productionLog.itemBoard", event);
        }
    }

    /**
     * @param {number} playerId
     * @returns {void}
     */
    requestLog(playerId) {
        this._session.sendMessage(new ProductionLogRequestMessage(playerId));
    }

    /**
     * @param {number} itemType
     * @param {number} offset
     * @returns {void}
     */
    requestItemBoard(itemType, offset) {
        this._session.sendMessage(new ItemLeaderboardRequestMessage(itemType, offset));
    }
}
