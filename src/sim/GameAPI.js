import {AbstractMessage} from "@/common/AbstractMessage.js";

export class GameAPI {

    /**
     * @param {Game} game
     */
    constructor(game) {
        /**
         * @private
         */
        this._game = game;
    }

    /**
     * @returns {WireRegistry}
     */
    get wire() {
        return this._game.wire;
    }

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     */
    sendMessage(message, session) {
        if (!message.validate(this, session)) {
            return;
        }

        this._game.dispatchMessage(message, session);
    }
}
