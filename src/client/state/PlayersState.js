import {PlayerNamesEvent} from "@/common/PlayerEvents.js";
import {syntheticUsername} from "@/common/util.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap} from "@/client/state/ClientCache.js";

export const PLAYERS_SCHEMA = {
    usernameByPlayer: schemaMap(),
};

/**
 * Writes the need-to-know username map from the targeted name events.
 */
export class PlayersWriter extends AbstractCacheWriter {

    /**
     * Applies a name event; a known id overwrites, so a rename lands instantly.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof PlayerNamesEvent) {
            for (let i = 0; i < event.playerRefs.length; i += 1) {
                this._state.mapSet("players.usernameByPlayer", event.playerRefs[i], event.usernames[i]);
            }
        }
    }
}

/**
 * Derived reads over the players namespace.
 */
export class PlayersView extends AbstractCacheView {

    /**
     * @param {number} playerRef
     * @returns {string}
     */
    getUsernameByPlayerRef(playerRef) {
        const username = this._state.mapGet("players.usernameByPlayer", playerRef);
        if (username === undefined) {
            return syntheticUsername(playerRef);
        }
        return username;
    }
}
