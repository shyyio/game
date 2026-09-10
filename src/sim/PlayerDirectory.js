import {PlayerNamesEvent, FriendListEvent, AddFriendByCodeResultEvent} from "@/common/PlayerEvents.js";
import {PLAYER_REF_NONE} from "@/common/constants.js";

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
         * sessionRef -> playerRefs whose usernames the session already received.
         * @type {Map<number, Set<number>>}
         * @private
         */
        this._knownBySession = new Map();
    }

    /**
     * @param {number} sessionRef
     * @returns {void}
     */
    connect(sessionRef) {
        this._knownBySession.set(sessionRef, new Set());
    }

    /**
     * @param {number} sessionRef
     * @returns {void}
     */
    disconnect(sessionRef) {
        this._knownBySession.delete(sessionRef);
    }

    /**
     * Sends a session the usernames of the given players it has not seen yet.
     * @param {number} sessionRef
     * @param {Iterable<number>} playerRefs
     * @returns {void}
     */
    syncUsernames(sessionRef, playerRefs) {
        const known = this._knownBySession.get(sessionRef);
        const ids = [];
        const usernames = [];
        for (const playerRef of playerRefs) {
            if (playerRef === PLAYER_REF_NONE || known.has(playerRef)) {
                continue;
            }
            known.add(playerRef);
            ids.push(playerRef);
            usernames.push(this.game.players.getPlayerByRef(playerRef).username);
        }
        if (ids.length > 0) {
            this.game.bus.publishTo(sessionRef, new PlayerNamesEvent(ids, usernames));
        }
    }

    /**
     * Befriends by playerRef; an unknown id or self just re-sends the unchanged list.
     * @param {AbstractSession} session
     * @param {number} playerRef
     * @returns {void}
     */
    addFriend(session, playerRef) {
        if (this.game.players.hasPlayer(playerRef) && playerRef !== session.playerRef) {
            this.game.players.addFriend(session.playerRef, playerRef);
            this._syncBothSides(session, playerRef);
            return;
        }
        this.syncFriendList(session.sessionRef, session.playerRef);
    }

    /**
     * Befriends by friend code, telling the asking session whether the code matched anyone.
     * @param {AbstractSession} session
     * @param {string} code
     * @returns {void}
     */
    addFriendByCode(session, code) {
        const target = this.game.players.getPlayerByFriendCodeOrNull(code);
        const playerRef = target === null ? PLAYER_REF_NONE : target.playerRef;
        const found = playerRef !== PLAYER_REF_NONE && playerRef !== session.playerRef;
        this.addFriend(session, playerRef);
        this.game.bus.publishTo(session.sessionRef, new AddFriendByCodeResultEvent(code, found));
    }

    /**
     * Unfriends by playerRef, resyncing both sides and letting mods react to the lost build rights.
     * @param {AbstractSession} session
     * @param {number} playerRef
     * @returns {void}
     */
    removeFriend(session, playerRef) {
        this.game.players.removeFriend(session.playerRef, playerRef);
        this._syncBothSides(session, playerRef);
        for (const mod of this.game.modRegistry.simMods) {
            mod.onFriendRemoved(session.playerRef, playerRef, this.game);
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
        this.syncFriendList(session.sessionRef, session.playerRef);
        for (const sessionRef of this.game.bus.getSessionRefsByPlayerRef(friendId)) {
            this.syncFriendList(sessionRef, friendId);
        }
    }

    /**
     * Sends one session a player's friend lists, both sides' names first.
     * @param {number} sessionRef
     * @param {number} playerRef
     * @returns {void}
     */
    syncFriendList(sessionRef, playerRef) {
        const friendIds = Array.from(this.game.players.getPlayerByRef(playerRef).friends);
        const grantedByIds = this.game.players.getGrantedRefsByPlayerRef(playerRef);
        this.syncUsernames(sessionRef, friendIds.concat(grantedByIds));
        this.game.bus.publishTo(sessionRef, new FriendListEvent(friendIds, grantedByIds));
    }
}
