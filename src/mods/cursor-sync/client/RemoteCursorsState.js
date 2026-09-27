import {AbstractCacheWriter, ChunkUnsubscribeEvent, chunkKeyAt, schemaMap} from "@spup/sdk/client";
import {
    PlayerCursorEvent,
    PlayerCursorHideEvent,
    PlayerSelectionStartEvent,
    PlayerSelectionEndEvent,
    PlayerPasteEvent,
    PlayerPasteClearEvent,
} from "../common/events.js";
import {CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_DEFAULT, isAudienceAdmitting} from "../common/constants.js";

export const REMOTE_CURSORS_SCHEMA = {
    byPlayer: schemaMap(),
    selectionByPlayer: schemaMap(),
    pasteByPlayer: schemaMap(),
};

// Every map keyed by player; a player's preview goes with their cursor.
const REMOTE_CURSOR_PATHS = ["remoteCursors.byPlayer", "remoteCursors.selectionByPlayer", "remoteCursors.pasteByPlayer"];

/**
 * @typedef {object} RemoteCursorState one remote player's live cursor
 * @property {number} playerRef
 * @property {number} x tile x, fractional
 * @property {number} y tile y, fractional
 */

/**
 * @typedef {object} RemoteSelectionState one remote player's open selection
 * @property {number} playerRef
 * @property {number} x the fixed corner's tile x, fractional
 * @property {number} y
 * @property {number} toolId
 */

/**
 * @typedef {object} RemotePasteState the mask of the blueprint one remote player holds to paste
 * @property {number} playerRef
 * @property {number} tileWidth
 * @property {number} tileHeight
 * @property {RowRun[]} rowRuns
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
     * @param {CursorAudience} mode
     * @returns {void}
     */
    _setDisplayMode(mode) {
        this._displayMode = mode;
        for (const path of REMOTE_CURSOR_PATHS) {
            this._state.mapDeleteWhere(path, entry => !this._isPlayerAdmitted(entry.playerRef));
        }
    }

    /**
     * Drops a player's cursor with its preview.
     * @private
     * @param {number} playerRef
     * @returns {void}
     */
    _deletePlayer(playerRef) {
        for (const path of REMOTE_CURSOR_PATHS) {
            this._state.mapDelete(path, playerRef);
        }
    }

    /**
     * Whether the display setting admits a player's cursor.
     * @private
     * @param {number} playerRef
     * @returns {boolean}
     */
    _isPlayerAdmitted(playerRef) {
        // Own players are never mirrored; self-admission never applies.
        return isAudienceAdmitting(this._displayMode, false, this._claims.isFriend(playerRef));
    }

    /**
     * Whether a player's cursor and preview are mirrored: another player the display setting admits.
     * @private
     * @param {number} playerRef
     * @returns {boolean}
     */
    _isPlayerMirrored(playerRef) {
        return playerRef !== this._claims.ownPlayerRef && this._isPlayerAdmitted(playerRef);
    }

    /**
     * Applies a cursor or preview event; a chunk unsubscribe drops the cursors it contained.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof PlayerCursorEvent) {
            if (this._isPlayerMirrored(event.playerRef)) {
                this._state.mapSet("remoteCursors.byPlayer", event.playerRef, {
                    playerRef: event.playerRef,
                    x: event.x,
                    y: event.y,
                });
            }
        } else if (event instanceof PlayerSelectionStartEvent) {
            if (this._isPlayerMirrored(event.playerRef)) {
                this._state.mapSet("remoteCursors.selectionByPlayer", event.playerRef, {
                    playerRef: event.playerRef,
                    x: event.x,
                    y: event.y,
                    toolId: event.toolId,
                });
            }
        } else if (event instanceof PlayerPasteEvent) {
            if (this._isPlayerMirrored(event.playerRef)) {
                this._state.mapSet("remoteCursors.pasteByPlayer", event.playerRef, {
                    playerRef: event.playerRef,
                    tileWidth: event.tileWidth,
                    tileHeight: event.tileHeight,
                    rowRuns: event.getRowRuns(),
                });
            }
        } else if (event instanceof PlayerSelectionEndEvent) {
            this._state.mapDelete("remoteCursors.selectionByPlayer", event.playerRef);
        } else if (event instanceof PlayerPasteClearEvent) {
            this._state.mapDelete("remoteCursors.pasteByPlayer", event.playerRef);
        } else if (event instanceof PlayerCursorHideEvent) {
            this._deletePlayer(event.playerRef);
        } else if (event instanceof ChunkUnsubscribeEvent) {
            for (const [playerRef, cursor] of Array.from(this._state.mapEntries("remoteCursors.byPlayer"))) {
                if (chunkKeyAt(cursor.x, cursor.y) === event.chunkKey) {
                    this._deletePlayer(playerRef);
                }
            }
        }
    }
}
