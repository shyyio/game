import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * Told to a session right after it authenticates: its own identity and chunk allowance. Targeted
 * (publishTo), never topic-routed.
 */
export class WelcomeEvent extends AbstractEvent {

    static wireFields = {
        ownPlayerRef: "int64",
        ownMaxChunks: "int32",
        ownFriendCode: "string",
    };

    /**
     * @param {number} ownPlayerRef
     * @param {number} ownMaxChunks
     * @param {string} ownFriendCode
     */
    constructor(ownPlayerRef, ownMaxChunks, ownFriendCode) {
        super();
        this.ownPlayerRef = ownPlayerRef;
        this.ownMaxChunks = ownMaxChunks;
        this.ownFriendCode = ownFriendCode;
    }
}

/**
 * playerRef -> username entries as parallel arrays, sent to a session only for players it can see
 * (claim owners in its viewport or requested overworld rects, visible cursors, friends). Targeted
 * (publishTo), never broadcast; a repeated id carries a rename. The only place usernames cross
 * the wire after sign-in.
 */
export class PlayerNamesEvent extends AbstractEvent {

    static wireFields = {
        playerRefs: "int64[]",
        usernames: "string[]",
    };

    /**
     * @param {number[]} playerRefs
     * @param {string[]} usernames
     */
    constructor(playerRefs, usernames) {
        super();
        this.playerRefs = playerRefs;
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

/**
 * The outcome of an {@link AddFriendByCodeMessage}: whether the code resolved to another real
 * player. Targeted (publishTo).
 */
export class AddFriendByCodeResultEvent extends AbstractEvent {

    static wireFields = {
        code: "string",
        isFound: "bool",
    };

    /**
     * @param {string} code
     * @param {boolean} isFound
     */
    constructor(code, isFound) {
        super();
        this.code = code;
        this.isFound = isFound;
    }
}