import {AbstractSimMod, chunkKeyAt} from "@spup/sdk";
import {NOTE_TABLE} from "./common/constants.js";
import {NotePlaceMessage, NoteEditMessage, NoteDeleteMessage} from "./common/messages.js";
import {NoteSetEvent, NoteDeleteEvent} from "./common/events.js";
import {Note} from "./common/Note.js";
import {NotesStore} from "./sim/NotesStore.js";

/**
 * Keeps every player-placed note: one per tile, placed by anyone with build rights on the chunk,
 * edited by its author alone, deleted by its author or a build-rights holder. Notes ride a chunk's
 * sync bundle like any other content and persist in the save as a table.
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
    init(engine) {
        engine.registerSystem(this._store);
    }

    /**
     * Sends the author names the chunk's incoming notes need, before their sync bundle.
     * @param {AbstractSession} session
     * @param {number} chunkKey
     * @param {Game} game
     * @returns {void}
     */
    onChunkSubscribed(session, chunkKey, game) {
        game.playerDirectory.syncUsernames(session.sessionRef, this._store.getAuthorIdsByChunkKey(chunkKey));
    }

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {boolean}
     */
    onSessionMessage(message, session, game) {
        if (message instanceof NotePlaceMessage) {
            this._dispatchNotePlace(message, session, game);
            return true;
        }
        if (message instanceof NoteEditMessage) {
            this._dispatchNoteEdit(message, session, game);
            return true;
        }
        if (message instanceof NoteDeleteMessage) {
            this._dispatchNoteDelete(message, session, game);
            return true;
        }
        return false;
    }

    /**
     * @returns {object[]}
     */
    serializeTables() {
        return this._store.serializeTables();
    }

    /**
     * @param {Map<string, object>} tablesByName
     * @returns {void}
     */
    deserializeTables(tablesByName) {
        this._store.deserializeTables(tablesByName.get(NOTE_TABLE));
    }

    /**
     * Places a note on an empty tile of a chunk the sender may build in; a foreign note on the tile
     * blocks it, the sender's own is overwritten.
     * @param {NotePlaceMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _dispatchNotePlace(message, session, game) {
        const chunkKey = chunkKeyAt(message.tileX, message.tileY);
        // Mod messages bypass the core placement gate, so notes check it themselves.
        if (!game.simEngine.canBuildIn(session.playerRef, chunkKey)) {
            return;
        }
        const existing = this._store.getNoteAtOrNull(message.tileX, message.tileY);
        if (existing !== null && existing.authorRef !== session.playerRef) {
            return;
        }
        const note = new Note(
            message.tileX,
            message.tileY,
            message.offsetMx,
            message.offsetMy,
            session.playerRef,
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
    _dispatchNoteEdit(message, session, game) {
        const note = this._store.getNoteAtOrNull(message.tileX, message.tileY);
        if (note === null || note.authorRef !== session.playerRef) {
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
    _dispatchNoteDelete(message, session, game) {
        const note = this._store.getNoteAtOrNull(message.tileX, message.tileY);
        if (note === null) {
            return;
        }
        const chunkKey = chunkKeyAt(message.tileX, message.tileY);
        if (note.authorRef !== session.playerRef && !game.simEngine.canBuildIn(session.playerRef, chunkKey)) {
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
            note.authorRef,
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
        const subscribers = event.getSubscribersByBus(game.bus);
        const authorIds = [event.authorRef];
        for (const sessionRef of subscribers) {
            game.playerDirectory.syncUsernames(sessionRef, authorIds);
        }
        game.bus.publish(event);
    }
}
