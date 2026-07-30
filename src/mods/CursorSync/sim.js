import {AbstractSimMod, SETTING_OFF} from "@/sdk/common.js";
import {CURSOR_SETTING_SHARE} from "./common/constants.js";
import {CursorMoveMessage, CursorHideMessage} from "./common/messages.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "./common/events.js";

/**
 * A session's published cursor: its owner and the chunk it was last seen in, for targeted hides.
 */
class CursorState {

    /**
     * @param {number} playerId
     * @param {number} chunk
     */
    constructor(playerId, chunk) {
        this.playerId = playerId;
        this.chunk = chunk;
    }
}

/**
 * Relays each session's cursor heartbeats to the sessions viewing its chunk, hiding it for
 * viewers losing sight (chunk crossing, hide message, share-off, disconnect).
 */
export class CursorSyncSimMod extends AbstractSimMod {

    constructor() {
        super();
        /**
         * sessionId -> its cursor's {@link CursorState}, present only while the cursor is shown.
         * @type {Map<number, CursorState>}
         */
        this._cursorBySession = new Map();
    }

    /**
     * No ECS content; the mod lives entirely at the session level.
     * @param {GameEngine} sim
     * @returns {void}
     */
    setup(sim) {}

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {boolean}
     */
    onSessionMessage(message, session, game) {
        if (message instanceof CursorMoveMessage) {
            this._handleCursorMove(message, session, game);
            return true;
        }
        if (message instanceof CursorHideMessage) {
            this._hideCursor(session.id, game);
            return true;
        }
        return false;
    }

    /**
     * @param {number} sessionId
     * @param {Game} game
     * @returns {void}
     */
    onSessionDisconnect(sessionId, game) {
        this._hideCursor(sessionId, game);
    }

    /**
     * @param {AbstractSession} session
     * @param {number} key
     * @param {number} value
     * @param {Game} game
     * @returns {void}
     */
    onPlayerSettingWritten(session, key, value, game) {
        // The client hides on its own share-off, but the erase must not depend on it.
        if (key === CURSOR_SETTING_SHARE && value === SETTING_OFF) {
            this._hideCursor(session.id, game);
        }
    }

    /**
     * Publishes a cursor heartbeat to its chunk's viewers, hiding it first for viewers losing
     * sight on a chunk crossing.
     * @param {CursorMoveMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _handleCursorMove(message, session, game) {
        // Client-side gating trusted but re-checked: a share-off player's cursor never fans out.
        if (game.playerSettings.get(session.playerId, CURSOR_SETTING_SHARE) === SETTING_OFF) {
            return;
        }
        const event = new PlayerCursorEvent(session.playerId, message.x, message.y);
        // The chunk getter recomputes; derive it once per heartbeat.
        const chunk = event.chunk;
        const state = this._cursorBySession.get(session.id);
        if (state === undefined) {
            this._cursorBySession.set(session.id, new CursorState(session.playerId, chunk));
        } else {
            if (state.chunk !== chunk) {
                this._publishCursorHide(state.playerId, state.chunk, chunk, session.id, game);
            }
            state.chunk = chunk;
        }
        const viewers = game.bus.chunkSubscribers(chunk);
        if (viewers === undefined) {
            return;
        }
        // Copied: a viewer's own dispatch may resubscribe while we fan out.
        for (const viewerId of [...viewers]) {
            // The owning session never gets its own cursor echoed back.
            if (viewerId === session.id) {
                continue;
            }
            // The cursor label needs its owner's name; first sight of a player sends it.
            game.syncUsernames(viewerId, [session.playerId]);
            game.bus.publishTo(viewerId, event);
        }
    }

    /**
     * Erases a session's cursor for every viewer of its last chunk (hide message, share-off,
     * disconnect); a no-op when it was never shown.
     * @param {number} sessionId
     * @param {Game} game
     * @private
     */
    _hideCursor(sessionId, game) {
        const state = this._cursorBySession.get(sessionId);
        if (state === undefined) {
            return;
        }
        this._cursorBySession.delete(sessionId);
        this._publishCursorHide(state.playerId, state.chunk, null, sessionId, game);
    }

    /**
     * Sends a hide to the sessions viewing `fromChunk` but not `toChunk` (null: all of them).
     * @param {number} playerId
     * @param {number} fromChunk
     * @param {number|null} toChunk
     * @param {number} ownerSessionId
     * @param {Game} game
     * @private
     */
    _publishCursorHide(playerId, fromChunk, toChunk, ownerSessionId, game) {
        const losing = game.bus.chunkSubscribers(fromChunk);
        if (losing === undefined) {
            return;
        }
        const keeping = toChunk === null ? undefined : game.bus.chunkSubscribers(toChunk);
        // One shared instance: delivery only encodes, and publishTo never resubscribes.
        const event = new PlayerCursorHideEvent(playerId);
        for (const sessionId of losing) {
            if (sessionId === ownerSessionId) {
                continue;
            }
            if (keeping !== undefined && keeping.has(sessionId)) {
                continue;
            }
            game.bus.publishTo(sessionId, event);
        }
    }
}
