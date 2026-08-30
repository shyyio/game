import {PlayerNamesEvent, FriendListEvent, AddFriendByCodeResultEvent} from "@/common/PlayerEvents.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";

/**
 * Who each session is allowed to see: usernames travel on a need-to-know basis, and friendships are
 * the grant that widens it. Every send of a player-bearing event routes its ids through
 * {@link PlayerDirectory#syncUsernames} first.
 */
export class PlayerDirectory {

    /**
     * @param {Game} game
     */
    constructor(game) {
        this.game = game;
        /**
         * sessionId -> playerIds whose usernames the session already received.
         * @type {Map<number, Set<number>>}
         * @private
         */
        this._knownBySession = new Map();
    }

    /**
     * @param {number} sessionId
     * @returns {void}
     */
    connect(sessionId) {
        this._knownBySession.set(sessionId, new Set());
    }

    /**
     * @param {number} sessionId
     * @returns {void}
     */
    disconnect(sessionId) {
        this._knownBySession.delete(sessionId);
    }

    /**
     * Sends a session the usernames of the given players it has not seen yet.
     * @param {number} sessionId
     * @param {Iterable<number>} playerIds
     * @returns {void}
     */
    syncUsernames(sessionId, playerIds) {
        const known = this._knownBySession.get(sessionId);
        const ids = [];
        const usernames = [];
        for (const playerId of playerIds) {
            if (playerId === PLAYER_ID_NONE || known.has(playerId)) {
                continue;
            }
            known.add(playerId);
            ids.push(playerId);
            usernames.push(this.game.players.byId(playerId).username);
        }
        if (ids.length > 0) {
            this.game.bus.publishTo(sessionId, new PlayerNamesEvent(ids, usernames));
        }
    }

    /**
     * Befriends by playerId; an unknown id or self just re-sends the unchanged list.
     * @param {AbstractSession} session
     * @param {number} playerId
     * @returns {void}
     */
    addFriend(session, playerId) {
        if (this.game.players.has(playerId) && playerId !== session.playerId) {
            this.game.players.addFriend(session.playerId, playerId);
            this._syncBothSides(session, playerId);
            return;
        }
        this.syncFriendList(session.id, session.playerId);
    }

    /**
     * Befriends by friend code, telling the asking session whether the code matched anyone.
     * @param {AbstractSession} session
     * @param {string} code
     * @returns {void}
     */
    addFriendByCode(session, code) {
        const target = this.game.players.byFriendCode(code);
        const playerId = target === undefined ? PLAYER_ID_NONE : target.playerId;
        const found = playerId !== PLAYER_ID_NONE && playerId !== session.playerId;
        this.addFriend(session, playerId);
        this.game.bus.publishTo(session.id, new AddFriendByCodeResultEvent(code, found));
    }

    /**
     * Unfriends by playerId, resyncing both sides and letting mods react to the lost build rights.
     * @param {AbstractSession} session
     * @param {number} playerId
     * @returns {void}
     */
    removeFriend(session, playerId) {
        this.game.players.removeFriend(session.playerId, playerId);
        this._syncBothSides(session, playerId);
        for (const mod of this.game.modRegistry.simMods) {
            mod.onFriendRemoved(session.playerId, playerId, this.game);
        }
    }

    /**
     * Resyncs both sides of a friendship change: the acting session, and every connected session of
     * the (un)friended player, whose build rights just changed.
     * @private
     * @param {AbstractSession} session
     * @param {number} friendId
     * @returns {void}
     */
    _syncBothSides(session, friendId) {
        this.syncFriendList(session.id, session.playerId);
        for (const sessionId of this.game.bus.sessionIdsOf(friendId)) {
            this.syncFriendList(sessionId, friendId);
        }
    }

    /**
     * Sends one session a player's friend lists, both sides' names first.
     * @param {number} sessionId
     * @param {number} playerId
     * @returns {void}
     */
    syncFriendList(sessionId, playerId) {
        const friendIds = [...this.game.players.byId(playerId).friends];
        const grantedByIds = this.game.players.grantedBy(playerId);
        this.syncUsernames(sessionId, friendIds.concat(grantedByIds));
        this.game.bus.publishTo(sessionId, new FriendListEvent(friendIds, grantedByIds));
    }
}
