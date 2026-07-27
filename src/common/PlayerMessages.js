import {AbstractMessage} from "@/common/AbstractMessage.js";
import {PROTOCOL_VERSION, USERNAME_PATTERN} from "@/common/constants.js";

/**
 * The first frame on a fresh connection: authenticates the sender by username. Handled by the
 * server transport before a session exists, never dispatched through the engine.
 */
export class SignInMessage extends AbstractMessage {

    static wireFields = {
        protocolVersion: "int32",
        username: "string",
    };

    /**
     * @param {number} protocolVersion
     * @param {string} username
     */
    constructor(protocolVersion, username) {
        super();
        this.protocolVersion = protocolVersion;
        this.username = username;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return this.protocolVersion === PROTOCOL_VERSION && typeof this.username === "string" && USERNAME_PATTERN.test(this.username);
    }
}

/**
 * Grants a player build rights in the sender's chunks. By username: the friend may never have been
 * near the sender's territory, so an id is not always known client-side.
 */
export class AddFriendMessage extends AbstractMessage {

    static wireFields = {
        username: "string",
    };

    /**
     * @param {string} username
     */
    constructor(username) {
        super();
        this.username = username;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return typeof this.username === "string" && USERNAME_PATTERN.test(this.username);
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
