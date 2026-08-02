import {AbstractMessage} from "@/common/AbstractMessage.js";
import {GAME_VERSION} from "@/common/constants.js";
import {isValidFriendCode} from "@/common/FriendCode.js";

/**
 * The first frame on a fresh connection: authenticates the sender by a signed join token from
 * the auth server. Handled by the server transport before a session exists, never dispatched
 * through the engine.
 */
export class SignInMessage extends AbstractMessage {

    static wireFields = {
        version: "string",
        token: "string",
    };

    /**
     * @param {string} version
     * @param {string} token
     */
    constructor(version, token) {
        super();
        this.version = version;
        this.token = token;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return this.version === GAME_VERSION && typeof this.token === "string" && this.token.length > 0;
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

/**
 * Grants a player build rights in the sender's chunks, by friend code; an unknown code is
 * silently ignored.
 */
export class AddFriendByCodeMessage extends AbstractMessage {

    static wireFields = {
        code: "string",
    };

    /**
     * @param {string} code
     */
    constructor(code) {
        super();
        this.code = code;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return typeof this.code === "string" && isValidFriendCode(this.code);
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
