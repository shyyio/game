import {AbstractMessage} from "@/common/AbstractMessage.js";
import {GAME_VERSION, USERNAME_PATTERN} from "@/common/constants.js";

/**
 * The first frame on a fresh connection: authenticates the sender by username. Handled by the
 * server transport before a session exists, never dispatched through the engine.
 */
export class SignInMessage extends AbstractMessage {

    static wireFields = {
        version: "string",
        username: "string",
    };

    /**
     * @param {string} version
     * @param {string} username
     */
    constructor(version, username) {
        super();
        this.version = version;
        this.username = username;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return this.version === GAME_VERSION && typeof this.username === "string" && USERNAME_PATTERN.test(this.username);
    }
}

/**
 * Grants a player build rights in the sender's chunks.
 */
export class AddFriendMessage extends AbstractMessage {

    static wireFields = {
        playerId: "int64",
    };

    /**
     * @param {number} playerId
     */
    constructor(playerId) {
        super();
        this.playerId = playerId;
    }
}

export class RemoveFriendMessage extends AbstractMessage {

    static wireFields = {
        playerId: "int64",
    };

    /**
     * @param {number} playerId
     */
    constructor(playerId) {
        super();
        this.playerId = playerId;
    }
}

/**
 * Writes one of the sender's player settings.
 */
export class SetPlayerSettingMessage extends AbstractMessage {

    static wireFields = {
        key: "int32",
        value: "int32",
    };

    /**
     * @param {number} key
     * @param {number} value
     */
    constructor(key, value) {
        super();
        this.key = key;
        this.value = value;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.key) && Number.isInteger(this.value);
    }
}
