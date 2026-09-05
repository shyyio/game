import {AbstractChunkRoutedEvent} from "@spup/sdk";

/**
 * A note's current state at its tile: sent on place, on edit, and in a chunk's sync bundle.
 */
export class NoteSetEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        x: "sint32",
        y: "sint32",
        offsetMx: "int32",
        offsetMy: "int32",
        authorId: "int64",
        text: "string",
    };

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} offsetMx sub-tile x offset, milli-tiles
     * @param {number} offsetMy sub-tile y offset, milli-tiles
     * @param {number} authorId
     * @param {string} text
     */
    constructor(tileX, tileY, offsetMx, offsetMy, authorId, text) {
        super(tileX, tileY);
        this.offsetMx = offsetMx;
        this.offsetMy = offsetMy;
        this.authorId = authorId;
        this.text = text;
    }
}

/**
 * A note went away: deleted by its author or by a build-rights holder.
 */
export class NoteDeleteEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        x: "sint32",
        y: "sint32",
    };
}
