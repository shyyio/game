/**
 * @typedef Message
 * @property {number} type
 */

import {SetViewportMessage} from "@/common/CoreMessages.js";

const MAX_VIEWPORT_CHUNKS = 256;

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
     * @param {Message} message
     * @param {Session} session
     */
    sendMessage(message, session) {
        // TODO: Replace per-message validation with a registry pattern —
        //       each message type registers a validate(msg) function, and
        //       sendMessage looks it up rather than branching here.
        if (message instanceof SetViewportMessage) {
            if (message.chunks.length > MAX_VIEWPORT_CHUNKS) {
                return;
            }
        }

        this._game.dispatchMessage(message, session);
    }

}
