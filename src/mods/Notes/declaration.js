import {AbstractModDeclaration} from "@spup/sdk";
import {NotePlaceMessage, NoteEditMessage, NoteDeleteMessage} from "./common/messages.js";
import {NoteSetEvent, NoteDeleteEvent} from "./common/events.js";

export class NotesDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "Notes";
    }

    get wireClasses() {
        return [
            NotePlaceMessage,
            NoteEditMessage,
            NoteDeleteMessage,
            NoteSetEvent,
            NoteDeleteEvent,
        ];
    }
}
