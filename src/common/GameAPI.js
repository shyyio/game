import {Message} from "@/common/Message.js";

export class GameAPI {

    /**
     * @param game {Game}
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
     * @param {Message} message
     * @param {Session} session
     */
    sendMessage(message, session) {
        if (!message.validate(this, session)) {
            return;
        }

        this._game.dispatchMessage(message, session);
    }

}
