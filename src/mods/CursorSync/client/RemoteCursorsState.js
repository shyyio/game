import {AbstractCacheWriter, ChunkUnsubscribeEvent, chunkId, schemaMap, SETTING_OFF} from "@/sdk/client.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "../common/events.js";
import {CURSOR_SETTING_SHOW} from "../common/constants.js";

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
 * Writes the mirror of other players' cursors. The server hides a cursor for viewers losing sight
 * of it (chunk crossing, blur, share-off, disconnect); a chunk unsubscribe drops its cursors here,
 * closing the last gap. Registered under the "remoteCursors" namespace.
 */
export class RemoteCursorsWriter extends AbstractCacheWriter {

    /**
     * @param {ClientCache} state own-player identity and the show toggle
     */
    constructor(state) {
        super(state);
        this._enabled = true;
        state.subscribe("playerSettings.values", (key, value) => {
            if (key === CURSOR_SETTING_SHOW) {
                this._setEnabled(value !== SETTING_OFF);
            }
        });
    }

    /**
     * Applies the show toggle: disabling clears every cursor and ignores further updates.
     * @private
     * @param {boolean} enabled
     * @returns {void}
     */
    _setEnabled(enabled) {
        this._enabled = enabled;
        if (!enabled) {
            this._state.mapDeleteWhere("remoteCursors.byPlayer", () => true);
        }
    }

    /**
     * Applies a cursor event; a chunk unsubscribe drops the cursors it contained.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof PlayerCursorEvent) {
            if (!this._enabled || event.playerId === this._state.view("chunkClaims").ownPlayerId) {
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
