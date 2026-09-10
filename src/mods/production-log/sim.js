import {AbstractSimMod, PLAYER_REF_NONE, getOrCreate} from "@spup/sdk";
import {ITEM_PRODUCED_TABLE} from "./common/constants.js";
import {
    ProductionLogRequestMessage,
    ItemLeaderboardRequestMessage,
} from "./common/messages.js";
import {ItemsDiscoveredEvent, ProductionLogEvent} from "./common/events.js";
import {ProductionLog} from "./sim/ProductionLog.js";

/**
 * Keeps every player's all-time production counts off the engine's itemProduced notifications,
 * announces first-time productions, and answers log and leaderboard requests. Counts persist in the
 * save as a table.
 */
export class ProductionLogSimMod extends AbstractSimMod {

    constructor() {
        super();
        this._log = new ProductionLog();
        /**
         * @type {ItemRegistry|null}
         */
        this._items = null;
        /**
         * playerRef -> item types first produced this tick, announced at tick end.
         * @type {Map<number, number[]>}
         */
        this._discovered = new Map();
    }

    /**
     * No ECS content; the log only listens.
     * @param {GameEngine} engine
     * @returns {void}
     */
    init(engine) {
        this._items = engine.modRegistry.items;
        engine.itemProduced.add((playerRef, itemTypeId, amount) => this._record(playerRef, itemTypeId, amount));
    }

    /**
     * @param {Game} game
     * @returns {void}
     */
    onTick(game) {
        for (const [playerRef, itemTypeIds] of this._discovered) {
            game.bus.publishToPlayer(playerRef, new ItemsDiscoveredEvent(itemTypeIds));
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
            const page = this._log.getItemPageByItemTypeId(message.itemTypeId, message.offset, session.playerRef);
            this._publish(session, game, page.playerRefs, page);
            return true;
        }
        return false;
    }

    /**
     * @returns {object[]}
     */
    serializeTables() {
        return this._log.serializeTables();
    }

    /**
     * @param {Map<string, object>} tablesByName
     * @returns {void}
     */
    deserializeTables(tablesByName) {
        this._log.deserializeTables(tablesByName.get(ITEM_PRODUCED_TABLE), this._items);
    }

    /**
     * Counts a delivery for its owner; an unowned producer counts for nobody.
     * @param {number} playerRef
     * @param {number} itemTypeId
     * @param {number} amount
     * @private
     */
    _record(playerRef, itemTypeId, amount) {
        if (playerRef === PLAYER_REF_NONE) {
            return;
        }
        if (this._log.add(playerRef, itemTypeId, amount)) {
            getOrCreate(this._discovered, playerRef, () => []).push(itemTypeId);
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
        if (!game.players.hasPlayer(message.playerRef)) {
            return;
        }
        const counts = this._log.getCountsByPlayerRef(message.playerRef);
        const itemTypeIds = Array.from(counts.keys());
        this._publish(session, game, [message.playerRef], new ProductionLogEvent(
            message.playerRef,
            itemTypeIds,
            Array.from(counts.values()),
            itemTypeIds.map(itemTypeId => this._log.getRankByPlayerRef(message.playerRef, itemTypeId)),
        ));
    }

    /**
     * Sends an answer to one session, the names it mentions first.
     * @param {AbstractSession} session
     * @param {Game} game
     * @param {number[]} playerRefs
     * @param {AbstractEvent} event
     * @private
     */
    _publish(session, game, playerRefs, event) {
        game.playerDirectory.syncUsernames(session.sessionRef, playerRefs);
        game.bus.publishTo(session.sessionRef, event);
    }
}
