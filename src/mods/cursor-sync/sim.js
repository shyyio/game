import {AbstractSimMod} from "@spup/sdk";
import {
    CURSOR_SETTING_SHARE,
    CURSOR_SETTING_DISPLAY,
    CURSOR_AUDIENCE_NONE,
    CURSOR_AUDIENCE_FRIENDS,
    CURSOR_AUDIENCE_EVERYONE,
    CURSOR_AUDIENCE_DEFAULT,
    audienceAdmits,
} from "./common/constants.js";
import {CursorMoveMessage, CursorHideMessage} from "./common/messages.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "./common/events.js";
import {CursorState} from "./sim/CursorState.js";

/**
 * Relays each session's cursor heartbeats to the sessions viewing its chunk, hiding it for
 * viewers losing sight (chunk crossing, hide message, setting change, disconnect). Each
 * heartbeat passes two audience gates: the owner's share setting and the viewer's display setting.
 */
export class CursorSyncSimMod extends AbstractSimMod {

    constructor() {
        super();
        /**
         * sessionRef -> its cursor's {@link CursorState}, present only while the cursor is shown.
         * @type {Map<number, CursorState>}
         */
        this._cursorBySession = new Map();
    }

    /**
     * No ECS content; the mod lives entirely at the session level.
     * @param {GameEngine} engine
     * @returns {void}
     */
    setup(engine) {}

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
            this._hideCursor(session.sessionRef, game);
            return true;
        }
        return false;
    }

    /**
     * @param {number} sessionRef
     * @param {Game} game
     * @returns {void}
     */
    onSessionDisconnect(sessionRef, game) {
        this._hideCursor(sessionRef, game);
    }

    /**
     * @param {AbstractSession} session
     * @param {number} key
     * @param {number} value
     * @param {Game} game
     * @returns {void}
     */
    onPlayerSettingWritten(session, key, value, game) {
        if (value === CURSOR_AUDIENCE_EVERYONE) {
            return;
        }
        // The client applies its own narrowing write too, but the erase must not depend on it.
        // Erases are broad; the next heartbeat re-shows the cursor where still admitted.
        if (key === CURSOR_SETTING_SHARE) {
            this._hideCursor(session.sessionRef, game);
        }
        if (key === CURSOR_SETTING_DISPLAY) {
            this._eraseExcludedCursors(session.playerRef, value, game);
        }
    }

    /**
     * An unfriend cuts the remover's friends-narrowed sight both ways: the removed player loses
     * a friends-sharing remover's cursor, a friends-displaying remover loses the removed player's.
     * @param {number} playerRef
     * @param {number} friendId
     * @param {Game} game
     * @returns {void}
     */
    onFriendRemoved(playerRef, friendId, game) {
        if (this._audienceOf(playerRef, CURSOR_SETTING_SHARE, game) === CURSOR_AUDIENCE_FRIENDS) {
            game.bus.publishToPlayer(friendId, new PlayerCursorHideEvent(playerRef));
        }
        if (this._audienceOf(playerRef, CURSOR_SETTING_DISPLAY, game) === CURSOR_AUDIENCE_FRIENDS) {
            game.bus.publishToPlayer(playerRef, new PlayerCursorHideEvent(friendId));
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
        // Client-side gating trusted but re-checked: a non-sharing player's cursor never fans out.
        const shareMode = this._audienceOf(session.playerRef, CURSOR_SETTING_SHARE, game);
        if (shareMode === CURSOR_AUDIENCE_NONE) {
            return;
        }
        const event = new PlayerCursorEvent(session.playerRef, message.x, message.y);
        // The chunk getter recomputes; derive it once per heartbeat.
        const chunkKey = event.chunkKey;
        const state = this._cursorBySession.get(session.sessionRef);
        if (state === undefined) {
            this._cursorBySession.set(session.sessionRef, new CursorState(session.playerRef, chunkKey));
        } else {
            if (state.chunkKey !== chunkKey) {
                this._publishCursorHide(state.playerRef, state.chunkKey, chunkKey, session.sessionRef, game);
            }
            state.chunkKey = chunkKey;
        }
        const viewers = game.bus.chunkSubscribers(chunkKey);
        if (viewers === undefined) {
            return;
        }
        // Copied: a viewer's own dispatch may resubscribe while we fan out.
        for (const viewerSessionRef of Array.from(viewers)) {
            // The owning session never gets its own cursor echoed back.
            if (viewerSessionRef === session.sessionRef) {
                continue;
            }
            const viewerId = game.bus.playerRefOf(viewerSessionRef);
            const isSelf = viewerId === session.playerRef;
            if (!audienceAdmits(shareMode, isSelf, game.players.isFriend(session.playerRef, viewerId))) {
                continue;
            }
            const displayMode = this._audienceOf(viewerId, CURSOR_SETTING_DISPLAY, game);
            if (!audienceAdmits(displayMode, isSelf, game.players.isFriend(viewerId, session.playerRef))) {
                continue;
            }
            // The cursor label needs its owner's name; first sight of a player sends it.
            game.playerDirectory.syncUsernames(viewerSessionRef, [session.playerRef]);
            game.bus.publishTo(viewerSessionRef, event);
        }
    }

    /**
     * @param {number} playerRef
     * @param {number} key CURSOR_SETTING_SHARE or CURSOR_SETTING_DISPLAY
     * @param {Game} game
     * @returns {number} the player's CURSOR_AUDIENCE_* option
     * @private
     */
    _audienceOf(playerRef, key, game) {
        const value = game.playerSettings.get(playerRef, key);
        return value === undefined ? CURSOR_AUDIENCE_DEFAULT : value;
    }

    /**
     * Erases every shown cursor a viewer's narrowed display setting no longer admits.
     * @param {number} viewerId
     * @param {number} mode the new CURSOR_AUDIENCE_* option
     * @param {Game} game
     * @private
     */
    _eraseExcludedCursors(viewerId, mode, game) {
        const excludedIds = new Set();
        for (const state of this._cursorBySession.values()) {
            const isSelf = viewerId === state.playerRef;
            if (!audienceAdmits(mode, isSelf, game.players.isFriend(viewerId, state.playerRef))) {
                excludedIds.add(state.playerRef);
            }
        }
        for (const excludedId of excludedIds) {
            game.bus.publishToPlayer(viewerId, new PlayerCursorHideEvent(excludedId));
        }
    }

    /**
     * Erases a session's cursor for every viewer of its last chunk (hide message, share change,
     * disconnect); a no-op when it was never shown.
     * @param {number} sessionRef
     * @param {Game} game
     * @private
     */
    _hideCursor(sessionRef, game) {
        const state = this._cursorBySession.get(sessionRef);
        if (state === undefined) {
            return;
        }
        this._cursorBySession.delete(sessionRef);
        this._publishCursorHide(state.playerRef, state.chunkKey, null, sessionRef, game);
    }

    /**
     * Sends a hide to the sessions viewing `fromChunk` but not `toChunk` (null: all of them).
     * @param {number} playerRef
     * @param {number} fromChunk
     * @param {number|null} toChunk
     * @param {number} ownerSessionRef
     * @param {Game} game
     * @private
     */
    _publishCursorHide(playerRef, fromChunk, toChunk, ownerSessionRef, game) {
        const losing = game.bus.chunkSubscribers(fromChunk);
        if (losing === undefined) {
            return;
        }
        const keeping = toChunk === null ? undefined : game.bus.chunkSubscribers(toChunk);
        // One shared instance: delivery only encodes, and publishTo never resubscribes.
        const event = new PlayerCursorHideEvent(playerRef);
        for (const sessionRef of losing) {
            if (sessionRef === ownerSessionRef) {
                continue;
            }
            if (keeping !== undefined && keeping.has(sessionRef)) {
                continue;
            }
            game.bus.publishTo(sessionRef, event);
        }
    }
}
