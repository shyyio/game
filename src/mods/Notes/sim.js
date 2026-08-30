import {AbstractSimMod, chunkId} from "@spup/sdk";
import {NOTE_RECORD} from "./common/constants.js";
import {NotePlaceMessage, NoteEditMessage, NoteDeleteMessage} from "./common/messages.js";
import {NoteSetEvent, NoteDeleteEvent} from "./common/events.js";
import {Note} from "./common/Note.js";
import {NotesStore} from "./sim/NotesStore.js";

/**
 * Keeps every player-placed note: one per tile, placed by anyone with build rights on the chunk,
 * edited by its author alone, deleted by its author or a build-rights holder. Notes ride a chunk's
 * sync bundle like any other content and persist in the save as a record table.
 */
export class NotesSimMod extends AbstractSimMod {

    constructor() {
        super();
        this._store = new NotesStore();
    }

    /**
     * No ECS content; notes coexist with objects instead of occupying tiles.
     * @param {GameEngine} engine
     * @returns {void}
     */
    setup(engine) {
        engine.registerChunkSync(chunk => this._store.notesIn(chunk).map(note => this._setEvent(note)));
    }

    /**
     * Sends the author names the chunk's incoming notes need, before their sync bundle.
     * @param {AbstractSession} session
     * @param {number} chunk
     * @param {Game} game
     * @returns {void}
     */
    onChunkSubscribed(session, chunk, game) {
        game.playerDirectory.syncUsernames(session.id, this._store.authorIdsIn(chunk));
    }

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {boolean}
     */
    onSessionMessage(message, session, game) {
        if (message instanceof NotePlaceMessage) {
            this._handlePlace(message, session, game);
            return true;
        }
        if (message instanceof NoteEditMessage) {
            this._handleEdit(message, session, game);
            return true;
        }
        if (message instanceof NoteDeleteMessage) {
            this._handleDelete(message, session, game);
            return true;
        }
        return false;
    }

    /**
     * @returns {object[]}
     */
    serializeRecords() {
        return this._store.serializeRecords();
    }

    /**
     * @param {Map<string, object>} tablesByName
     * @returns {void}
     */
    deserializeRecords(tablesByName) {
        this._store.deserializeRecords(tablesByName.get(NOTE_RECORD));
    }

    /**
     * Places a note on an empty tile of a chunk the sender may build in; a foreign note on the tile
     * blocks it, the sender's own is overwritten.
     * @param {NotePlaceMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _handlePlace(message, session, game) {
        const chunk = chunkId(message.tileX, message.tileY);
        // Mod messages bypass the core placement gate, so notes check it themselves.
        if (!game.simEngine.placementAllowed(session.playerId, chunk)) {
            return;
        }
        const existing = this._store.get(message.tileX, message.tileY);
        if (existing !== null && existing.authorId !== session.playerId) {
            return;
        }
        const note = new Note(
            message.tileX,
            message.tileY,
            message.offsetMx,
            message.offsetMy,
            session.playerId,
            message.text,
        );
        this._store.set(note);
        this._publish(this._setEvent(note), game);
    }

    /**
     * Rewrites a note's text for its author. No placement re-check: an author keeps editing their
     * own note after losing the chunk.
     * @param {NoteEditMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _handleEdit(message, session, game) {
        const note = this._store.get(message.tileX, message.tileY);
        if (note === null || note.authorId !== session.playerId) {
            return;
        }
        note.text = message.text;
        this._publish(this._setEvent(note), game);
    }

    /**
     * Removes a note for its author or for anyone holding build rights on its chunk.
     * @param {NoteDeleteMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _handleDelete(message, session, game) {
        const note = this._store.get(message.tileX, message.tileY);
        if (note === null) {
            return;
        }
        const chunk = chunkId(message.tileX, message.tileY);
        if (note.authorId !== session.playerId && !game.simEngine.placementAllowed(session.playerId, chunk)) {
            return;
        }
        this._store.delete(message.tileX, message.tileY);
        game.bus.publish(new NoteDeleteEvent(message.tileX, message.tileY));
    }

    /**
     * @param {Note} note
     * @returns {NoteSetEvent}
     * @private
     */
    _setEvent(note) {
        return new NoteSetEvent(
            note.tileX,
            note.tileY,
            note.offsetMx,
            note.offsetMy,
            note.authorId,
            note.text,
        );
    }

    /**
     * Fans a note out to its chunk's viewers, each getting the author's name first so the panel
     * label resolves.
     * @param {NoteSetEvent} event
     * @param {Game} game
     * @private
     */
    _publish(event, game) {
        const subscribers = event.subscribersIn(game.bus);
        if (subscribers === undefined) {
            return;
        }
        const authorIds = [event.authorId];
        for (const sessionId of subscribers) {
            game.playerDirectory.syncUsernames(sessionId, authorIds);
        }
        game.bus.publish(event);
    }
}
