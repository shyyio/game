import {AbstractSimMod} from "@spup/sdk";
import {
    CURSOR_SETTING_SHARE,
    CURSOR_SETTING_DISPLAY,
    CURSOR_AUDIENCE_NONE,
    CURSOR_AUDIENCE_FRIENDS,
    CURSOR_AUDIENCE_EVERYONE,
    CURSOR_AUDIENCE_DEFAULT,
    isAudienceAdmitting,
} from "./common/constants.js";
import {
    CursorMoveMessage, CursorHideMessage, CursorSelectionStartMessage, CursorSelectionEndMessage, CursorPasteMessage, CursorPasteClearMessage,
} from "./common/messages.js";
import {
    PlayerCursorEvent, PlayerCursorHideEvent, PlayerSelectionStartEvent, PlayerSelectionEndEvent, PlayerPasteEvent, PlayerPasteClearEvent,
} from "./common/events.js";

/**
 * A session's published cursor: its owner and the chunk it was last seen in, for targeted hides.
 */
class CursorEntry {

    /**
     * @param {number} playerRef
     * @param {number} chunkKey
     */
    constructor(playerRef, chunkKey) {
        this.playerRef = playerRef;
        this.chunkKey = chunkKey;
        /**
         * The viewers holding the session's current tool preview.
         * @type {Set<number>}
         */
        this.previewViewerSessionRefs = new Set();
    }
}

/**
 * A session's tool preview, as the events that show it; kept while its cursor is hidden.
 */
class PreviewEntry {

    constructor() {
        /** @type {PlayerSelectionStartEvent|null} */
        this.selection = null;
        /** @type {PlayerPasteEvent|null} */
        this.paste = null;
    }
}

/**
 * Relays each session's cursor heartbeats to the sessions viewing its chunk, hiding it for
 * viewers losing sight (chunk crossing, hide message, setting change, disconnect). Each
 * heartbeat passes two audience gates: the owner's share setting and the viewer's display setting.
 * The session's tool preview (open selection, held paste) shows wherever its cursor shows.
 */
export class CursorSyncSimMod extends AbstractSimMod {

    constructor() {
        super();
        /**
         * sessionRef -> its cursor's {@link CursorEntry}, present only while the cursor is shown.
         * @type {Map<number, CursorEntry>}
         */
        this._cursorBySession = new Map();
        /** @type {Map<number, PreviewEntry>} */
        this._previewBySession = new Map();
    }

    /**
     * No ECS content; the mod lives entirely at the session level.
     * @param {GameEngine} engine
     * @returns {void}
     */
    init(engine) {}

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {boolean}
     */
    onSessionMessage(message, session, game) {
        if (message instanceof CursorMoveMessage) {
            this._dispatchCursorMove(message, session, game);
            return true;
        }
        if (message instanceof CursorHideMessage) {
            this._hideCursor(session.sessionRef, game);
            return true;
        }
        if (message instanceof CursorSelectionStartMessage) {
            const event = new PlayerSelectionStartEvent(session.playerRef, message.x, message.y, message.toolId);
            this._getOrAddPreviewBySessionRef(session.sessionRef).selection = event;
            this._publishPreview(event, session, game);
            return true;
        }
        if (message instanceof CursorSelectionEndMessage) {
            this._getOrAddPreviewBySessionRef(session.sessionRef).selection = null;
            this._publishPreview(new PlayerSelectionEndEvent(session.playerRef), session, game);
            return true;
        }
        if (message instanceof CursorPasteMessage) {
            const event = new PlayerPasteEvent(session.playerRef, message.tileWidth, message.runs);
            this._getOrAddPreviewBySessionRef(session.sessionRef).paste = event;
            this._publishPreview(event, session, game);
            return true;
        }
        if (message instanceof CursorPasteClearMessage) {
            this._getOrAddPreviewBySessionRef(session.sessionRef).paste = null;
            this._publishPreview(new PlayerPasteClearEvent(session.playerRef), session, game);
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
        this._previewBySession.delete(sessionRef);
    }

    /**
     * A fresh subscriber holds none of the chunk's previews; the next heartbeat replays them.
     * @param {AbstractSession} session
     * @param {number} chunkKey
     * @param {Game} game
     * @returns {void}
     */
    onChunkSubscribed(session, chunkKey, game) {
        for (const cursor of this._cursorBySession.values()) {
            if (cursor.chunkKey === chunkKey) {
                cursor.previewViewerSessionRefs.delete(session.sessionRef);
            }
        }
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
        if (this._getAudienceByPlayerRef(playerRef, CURSOR_SETTING_SHARE, game) === CURSOR_AUDIENCE_FRIENDS) {
            game.bus.publishToPlayer(friendId, new PlayerCursorHideEvent(playerRef));
            this._forgetPreviewViewers(playerRef, friendId, game);
        }
        if (this._getAudienceByPlayerRef(playerRef, CURSOR_SETTING_DISPLAY, game) === CURSOR_AUDIENCE_FRIENDS) {
            game.bus.publishToPlayer(playerRef, new PlayerCursorHideEvent(friendId));
            this._forgetPreviewViewers(friendId, playerRef, game);
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
    _dispatchCursorMove(message, session, game) {
        // Client-side gating trusted but re-checked: a non-sharing player's cursor never fans out.
        const shareMode = this._getAudienceByPlayerRef(session.playerRef, CURSOR_SETTING_SHARE, game);
        if (shareMode === CURSOR_AUDIENCE_NONE) {
            return;
        }
        const event = new PlayerCursorEvent(session.playerRef, message.x, message.y);
        // The chunk getter recomputes; derive it once per heartbeat.
        const chunkKey = event.chunkKey;
        let cursor = this._cursorBySession.get(session.sessionRef);
        if (cursor === undefined) {
            cursor = new CursorEntry(session.playerRef, chunkKey);
            this._cursorBySession.set(session.sessionRef, cursor);
        } else {
            if (cursor.chunkKey !== chunkKey) {
                this._publishPlayerCursorHide(cursor, chunkKey, session.sessionRef, game);
            }
            cursor.chunkKey = chunkKey;
        }
        for (const viewerSessionRef of this._getAdmittedViewerSessionRefs(session, shareMode, chunkKey, game)) {
            // The cursor label needs its owner's name; first sight of a player sends it.
            game.playerDirectory.syncUsernames(viewerSessionRef, [session.playerRef]);
            if (!cursor.previewViewerSessionRefs.has(viewerSessionRef)) {
                this._publishPreviewReplay(session.sessionRef, viewerSessionRef, game);
                cursor.previewViewerSessionRefs.add(viewerSessionRef);
            }
            game.bus.publishTo(viewerSessionRef, event);
        }
    }

    /**
     * @param {number} sessionRef
     * @returns {PreviewEntry}
     * @private
     */
    _getOrAddPreviewBySessionRef(sessionRef) {
        let preview = this._previewBySession.get(sessionRef);
        if (preview === undefined) {
            preview = new PreviewEntry();
            this._previewBySession.set(sessionRef, preview);
        }
        return preview;
    }

    /**
     * Sends a viewer the parts of a session's tool preview that are showing.
     * @param {number} sessionRef
     * @param {number} viewerSessionRef
     * @param {Game} game
     * @private
     */
    _publishPreviewReplay(sessionRef, viewerSessionRef, game) {
        const preview = this._previewBySession.get(sessionRef);
        if (preview === undefined) {
            return;
        }
        if (preview.selection !== null) {
            game.bus.publishTo(viewerSessionRef, preview.selection);
        }
        if (preview.paste !== null) {
            game.bus.publishTo(viewerSessionRef, preview.paste);
        }
    }

    /**
     * Publishes a change of the sender's tool preview to the admitted viewers holding it; the
     * others get the whole preview replayed with the next heartbeat.
     * @param {AbstractEvent} event
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _publishPreview(event, session, game) {
        const cursor = this._cursorBySession.get(session.sessionRef);
        if (cursor === undefined) {
            return;
        }
        const shareMode = this._getAudienceByPlayerRef(session.playerRef, CURSOR_SETTING_SHARE, game);
        for (const viewerSessionRef of this._getAdmittedViewerSessionRefs(session, shareMode, cursor.chunkKey, game)) {
            if (cursor.previewViewerSessionRefs.has(viewerSessionRef)) {
                game.bus.publishTo(viewerSessionRef, event);
            }
        }
    }

    /**
     * The sessions viewing a chunk that both audience gates admit to a session's cursor, the
     * session itself excluded.
     * @param {AbstractSession} session
     * @param {CursorAudience} shareMode
     * @param {number} chunkKey
     * @param {Game} game
     * @returns {number[]}
     * @private
     */
    _getAdmittedViewerSessionRefs(session, shareMode, chunkKey, game) {
        const admitted = [];
        // Copied: a viewer's own dispatch may resubscribe while we fan out.
        for (const viewerSessionRef of Array.from(game.bus.getSubscribersByChunkKey(chunkKey))) {
            if (viewerSessionRef === session.sessionRef) {
                continue;
            }
            const viewerId = game.bus.getPlayerRefBySessionRef(viewerSessionRef);
            const isSelf = viewerId === session.playerRef;
            if (!isAudienceAdmitting(shareMode, isSelf, game.players.isFriend(session.playerRef, viewerId))) {
                continue;
            }
            const displayMode = this._getAudienceByPlayerRef(viewerId, CURSOR_SETTING_DISPLAY, game);
            if (!isAudienceAdmitting(displayMode, isSelf, game.players.isFriend(viewerId, session.playerRef))) {
                continue;
            }
            admitted.push(viewerSessionRef);
        }
        return admitted;
    }

    /**
     * @param {number} playerRef
     * @param {number} key CURSOR_SETTING_SHARE or CURSOR_SETTING_DISPLAY
     * @param {Game} game
     * @returns {CursorAudience}
     * @private
     */
    _getAudienceByPlayerRef(playerRef, key, game) {
        const value = game.playerSettings.getPlayerValueByKey(playerRef, key);
        return value === undefined ? CURSOR_AUDIENCE_DEFAULT : value;
    }

    /**
     * Erases every shown cursor a viewer's narrowed display setting no longer admits.
     * @param {number} viewerId
     * @param {CursorAudience} mode
     * @param {Game} game
     * @private
     */
    _eraseExcludedCursors(viewerId, mode, game) {
        const excludedIds = new Set();
        for (const state of this._cursorBySession.values()) {
            const isSelf = viewerId === state.playerRef;
            if (!isAudienceAdmitting(mode, isSelf, game.players.isFriend(viewerId, state.playerRef))) {
                excludedIds.add(state.playerRef);
            }
        }
        for (const excludedId of excludedIds) {
            game.bus.publishToPlayer(viewerId, new PlayerCursorHideEvent(excludedId));
            this._forgetPreviewViewers(excludedId, viewerId, game);
        }
    }

    /**
     * Marks a player's sessions as holding none of another player's previews, after a hide sent
     * to every one of them.
     * @param {number} ownerPlayerRef
     * @param {number} viewerPlayerRef
     * @param {Game} game
     * @private
     */
    _forgetPreviewViewers(ownerPlayerRef, viewerPlayerRef, game) {
        const viewerSessionRefs = game.bus.getSessionRefsByPlayerRef(viewerPlayerRef);
        for (const cursor of this._cursorBySession.values()) {
            if (cursor.playerRef !== ownerPlayerRef) {
                continue;
            }
            for (const viewerSessionRef of viewerSessionRefs) {
                cursor.previewViewerSessionRefs.delete(viewerSessionRef);
            }
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
        this._publishPlayerCursorHide(state, null, sessionRef, game);
    }

    /**
     * Sends a hide to the sessions viewing the cursor's chunk but not `toChunk` (null: all of
     * them), which drop its preview with it.
     * @param {CursorEntry} cursor
     * @param {number|null} toChunk
     * @param {number} ownerSessionRef
     * @param {Game} game
     * @private
     */
    _publishPlayerCursorHide(cursor, toChunk, ownerSessionRef, game) {
        const losing = game.bus.getSubscribersByChunkKey(cursor.chunkKey);
        let keeping;
        if (toChunk === null) {
            keeping = null;
        } else {
            keeping = game.bus.getSubscribersByChunkKey(toChunk);
        }
        // One shared instance: delivery only encodes, and publishTo never resubscribes.
        const event = new PlayerCursorHideEvent(cursor.playerRef);
        for (const sessionRef of losing) {
            if (sessionRef === ownerSessionRef) {
                continue;
            }
            if (keeping !== null && keeping.has(sessionRef)) {
                continue;
            }
            game.bus.publishTo(sessionRef, event);
            cursor.previewViewerSessionRefs.delete(sessionRef);
        }
        // A viewer that dropped the chunk dropped the cursor and its preview with it.
        for (const sessionRef of cursor.previewViewerSessionRefs) {
            if (!losing.has(sessionRef)) {
                cursor.previewViewerSessionRefs.delete(sessionRef);
            }
        }
    }
}
