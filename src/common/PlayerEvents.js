import {AbstractEvent} from "@/common/AbstractEvent.js";
import {AbstractBroadcastEvent} from "@/common/AbstractBroadcastEvent.js";

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
 * The playerId -> username directory, as parallel arrays: the full roster on connect, a one-entry
 * delta when a new player registers. The only place usernames cross the wire after sign-in.
 */
export class PlayerDirectoryEvent extends AbstractBroadcastEvent {

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