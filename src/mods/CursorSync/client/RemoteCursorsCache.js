import {ChunkUnsubscribeEvent, chunkId, SETTING_OFF} from "@/sdk/common.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "../common/events.js";
import {CURSOR_SETTING_SHOW} from "../common/constants.js";

/**
 * One remote player's live cursor.
 */
export class RemoteCursor {

    /**
     * @param {number} playerId
     * @param {number} x tile x, fractional
     * @param {number} y tile y, fractional
     */
    constructor(playerId, x, y) {
        this.playerId = playerId;
        this.x = x;
        this.y = y;
    }
}

/**
 * The client's mirror of other players' cursors, fed by the cursor events and read by the cursor
 * draw layer. The server hides a cursor for viewers losing sight of it (chunk crossing, blur,
 * share-off, disconnect); a chunk unsubscribe drops its cursors here, closing the last gap.
 */
export class RemoteCursorsCache {

    /**
     * @param {ChunkClaimsCache} claimsCache own-player identity, for dropping echoed own events
     * @param {PlayerSettings} playerSettings the show toggle
     */
    constructor(claimsCache, playerSettings) {
        this._claimsCache = claimsCache;

        /**
         * @type {Map<number, RemoteCursor>} playerId -> its live cursor
         */
        this._cursorsByPlayer = new Map();
        this._enabled = true;
        this._upsertListeners = [];
        this._removeListeners = [];
        playerSettings.onChange((key, value) => {
            if (key === CURSOR_SETTING_SHOW) {
                this._setEnabled(value !== SETTING_OFF);
            }
        });
    }

    /**
     * Registers a listener called with each written {@link RemoteCursor}.
     * @param {function(RemoteCursor): void} listener
     * @returns {void}
     */
    onUpsert(listener) {
        this._upsertListeners.push(listener);
    }

    /**
     * Registers a listener called with each removed cursor's playerId.
     * @param {function(number): void} listener
     * @returns {void}
     */
    onRemove(listener) {
        this._removeListeners.push(listener);
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
            for (const playerId of this._cursorsByPlayer.keys()) {
                this._remove(playerId);
            }
        }
    }

    /**
     * Applies a cursor event; the class list lives here alone. A chunk unsubscribe drops the
     * cursors it contained but is never consumed — other consumers tear the chunk down too.
     * @param {AbstractEvent} event
     * @returns {boolean} whether the event was consumed
     */
    onEvent(event) {
        if (event instanceof PlayerCursorEvent) {
            if (!this._enabled || event.playerId === this._claimsCache.ownPlayerId) {
                return true;
            }
            let cursor = this._cursorsByPlayer.get(event.playerId);
            if (cursor === undefined) {
                cursor = new RemoteCursor(event.playerId, event.x, event.y);
                this._cursorsByPlayer.set(event.playerId, cursor);
            } else {
                cursor.x = event.x;
                cursor.y = event.y;
            }
            for (const listener of this._upsertListeners) {
                listener(cursor);
            }
            return true;
        }
        if (event instanceof PlayerCursorHideEvent) {
            this._remove(event.playerId);
            return true;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            // Map iteration is delete-safe, and the remove listeners never write back.
            for (const cursor of this._cursorsByPlayer.values()) {
                if (chunkId(cursor.x, cursor.y) === event.chunk) {
                    this._remove(cursor.playerId);
                }
            }
        }
        return false;
    }

    /**
     * @private
     * @param {number} playerId
     * @returns {void}
     */
    _remove(playerId) {
        if (!this._cursorsByPlayer.delete(playerId)) {
            return;
        }
        for (const listener of this._removeListeners) {
            listener(playerId);
        }
    }
}
