import {AbstractCacheWriter, ChunkUnsubscribeEvent, chunkId, schemaMap} from "@spup/sdk/client";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "../common/events.js";
import {CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_DEFAULT, audienceAdmits} from "../common/constants.js";

export const REMOTE_CURSORS_SCHEMA = {
    byPlayer: schemaMap(),
};

/**
 * @typedef {object} RemoteCursorState one remote player's live cursor
 * @property {number} playerId
 * @property {number} x tile x, fractional
 * @property {number} y tile y, fractional
 */

/**
 * Writes the mirror of other players' cursors. The server gates delivery by the display setting and
 * hides a cursor for viewers losing sight of it; the setting is re-applied here so narrowing it
 * clears instantly, and a chunk unsubscribe drops its cursors, closing the last gap. Registered
 * under the "remoteCursors" namespace.
 */
export class RemoteCursorsWriter extends AbstractCacheWriter {

    /**
     * @param {ClientCache} state own-player identity, friend list, and the display setting
     */
    constructor(state) {
        super(state);
        this._claims = state.view("chunkClaims");
        this._displayMode = CURSOR_AUDIENCE_DEFAULT;
        state.subscribe("playerSettings.values", (key, value) => {
            if (key === CURSOR_SETTING_DISPLAY) {
                this._setDisplayMode(value);
            }
        });
    }

    /**
     * Applies the display setting: narrowing clears the cursors it no longer admits.
     * @private
     * @param {number} mode CURSOR_AUDIENCE_* option
     * @returns {void}
     */
    _setDisplayMode(mode) {
        this._displayMode = mode;
        this._state.mapDeleteWhere("remoteCursors.byPlayer", cursor => !this._admits(cursor.playerId));
    }

    /**
     * Whether the display setting admits a player's cursor.
     * @private
     * @param {number} playerId
     * @returns {boolean}
     */
    _admits(playerId) {
        // Own events are dropped before this gate; self-admission never applies.
        return audienceAdmits(this._displayMode, false, this._claims.isFriend(playerId));
    }

    /**
     * Applies a cursor event; a chunk unsubscribe drops the cursors it contained.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof PlayerCursorEvent) {
            if (event.playerId === this._claims.ownPlayerId || !this._admits(event.playerId)) {
                return;
            }
            this._state.mapSet("remoteCursors.byPlayer", event.playerId, {
                playerId: event.playerId,
                x: event.x,
                y: event.y,
            });
            return;
        }
        if (event instanceof PlayerCursorHideEvent) {
            this._state.mapDelete("remoteCursors.byPlayer", event.playerId);
            return;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            this._state.mapDeleteWhere("remoteCursors.byPlayer", cursor => chunkId(cursor.x, cursor.y) === event.chunk);
        }
    }
}
