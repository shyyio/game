import {AbstractSimMod, PLAYER_ID_NONE, getOrCreate} from "@spup/sdk";
import {ITEM_PRODUCED_RECORD} from "./common/constants.js";
import {
    ProductionLogRequestMessage,
    ItemLeaderboardRequestMessage,
} from "./common/messages.js";
import {ItemsDiscoveredEvent, ProductionLogEvent} from "./common/events.js";
import {ProductionLog} from "./sim/ProductionLog.js";

/**
 * Keeps every player's all-time production counts off the engine's itemProduced notifications,
 * announces first-time productions, and answers log and leaderboard requests. Counts persist in the
 * save as a record table.
 */
export class ProductionLogSimMod extends AbstractSimMod {

    constructor() {
        super();
        this._log = new ProductionLog();
        /**
         * playerId -> item types first produced this tick, announced at tick end.
         * @type {Map<number, number[]>}
         */
        this._discovered = new Map();
    }

    /**
     * No ECS content; the log only listens.
     * @param {GameEngine} engine
     * @returns {void}
     */
    setup(engine) {
        engine.itemProduced.add((playerId, itemType, amount) => this._record(playerId, itemType, amount));
    }

    /**
     * @param {Game} game
     * @returns {void}
     */
    onTick(game) {
        for (const [playerId, itemTypes] of this._discovered) {
            game.bus.publishToPlayer(playerId, new ItemsDiscoveredEvent(itemTypes));
        }
        this._discovered.clear();
    }

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {boolean}
     */
    onSessionMessage(message, session, game) {
        if (message instanceof ProductionLogRequestMessage) {
            this._answerLog(message, session, game);
            return true;
        }
        if (message instanceof ItemLeaderboardRequestMessage) {
            const page = this._log.itemPage(message.itemType, message.offset, session.playerId);
            this._publish(session, game, page.playerIds, page);
            return true;
        }
        return false;
    }

    /**
     * @returns {object[]}
     */
    serializeRecords() {
        return this._log.serializeRecords();
    }

    /**
     * @param {Map<string, object>} tablesByName
     * @returns {void}
     */
    deserializeRecords(tablesByName) {
        this._log.deserializeRecords(tablesByName.get(ITEM_PRODUCED_RECORD));
    }

    /**
     * Counts a delivery for its owner; an unowned producer counts for nobody.
     * @param {number} playerId
     * @param {number} itemType
     * @param {number} amount
     * @private
     */
    _record(playerId, itemType, amount) {
        if (playerId === PLAYER_ID_NONE) {
            return;
        }
        if (this._log.add(playerId, itemType, amount)) {
            getOrCreate(this._discovered, playerId, () => []).push(itemType);
        }
    }

    /**
     * Sends the asked player's counts, their name first; an unknown player is ignored.
     * @param {ProductionLogRequestMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _answerLog(message, session, game) {
        if (!game.players.has(message.playerId)) {
            return;
        }
        const counts = this._log.countsOf(message.playerId);
        const itemTypes = Array.from(counts.keys());
        this._publish(session, game, [message.playerId], new ProductionLogEvent(
            message.playerId,
            itemTypes,
            Array.from(counts.values()),
            itemTypes.map(itemType => this._log.rankOf(message.playerId, itemType)),
        ));
    }

    /**
     * Sends an answer to one session, the names it mentions first.
     * @param {AbstractSession} session
     * @param {Game} game
     * @param {number[]} playerIds
     * @param {AbstractEvent} event
     * @private
     */
    _publish(session, game, playerIds, event) {
        game.playerDirectory.syncUsernames(session.id, playerIds);
        game.bus.publishTo(session.id, event);
    }
}
