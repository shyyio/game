import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * Told to a session right after it authenticates: its own identity and chunk allowance. Targeted
 * (publishTo), never topic-routed.
 */
export class WelcomeEvent extends AbstractEvent {

    static wireFields = {
        playerId: "int64",
        maxChunks: "int32",
    };

    /**
     * @param {number} playerId
     * @param {number} maxChunks
     */
    constructor(playerId, maxChunks) {
        super();
        this.playerId = playerId;
        this.maxChunks = maxChunks;
    }
}

/**
 * playerId -> username entries as parallel arrays, sent to a session only for players it can see
 * (claim owners in its viewport or requested overworld rects, visible cursors, friends). Targeted
 * (publishTo), never broadcast; a repeated id carries a rename. The only place usernames cross
 * the wire after sign-in.
 */
export class PlayerNamesEvent extends AbstractEvent {

    static wireFields = {
        playerIds: "int64[]",
        usernames: "string[]",
    };

    /**
     * @param {number[]} playerIds
     * @param {string[]} usernames
     */
    constructor(playerIds, usernames) {
        super();
        this.playerIds = playerIds;
        this.usernames = usernames;
    }
}

/**
 * The receiving player's friendships, both directions: build rights granted (friendIds) and
 * received (grantedByIds). Targeted (publishTo).
 */
export class FriendListEvent extends AbstractEvent {

    static wireFields = {
        friendIds: "int64[]",
        grantedByIds: "int64[]",
    };

    /**
     * @param {number[]} friendIds
     * @param {number[]} grantedByIds
     */
    constructor(friendIds, grantedByIds) {
        super();
        this.friendIds = friendIds;
        this.grantedByIds = grantedByIds;
    }
}