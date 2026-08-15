import {AbstractMessage, TILE_HALF} from "@spup/sdk";
import {noteOffsetValid, noteTextValid} from "./constants.js";

/**
 * Whether a tile position is inside the region's half-open tile box, matching tileId's bounds.
 * @param {number} tileX
 * @param {number} tileY
 * @returns {boolean}
 */
function tileInBounds(tileX, tileY) {
    return Number.isInteger(tileX) && Number.isInteger(tileY)
        && tileX >= -TILE_HALF && tileX < TILE_HALF
        && tileY >= -TILE_HALF && tileY < TILE_HALF;
}

/**
 * Places a note on a tile, anchored at a sub-tile offset in milli-tiles.
 */
export class NotePlaceMessage extends AbstractMessage {

    static wireFields = {
        tileX: "sint32",
        tileY: "sint32",
        offsetMx: "int32",
        offsetMy: "int32",
        text: "string",
    };

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} offsetMx sub-tile x offset, milli-tiles
     * @param {number} offsetMy sub-tile y offset, milli-tiles
     * @param {string} text
     */
    constructor(tileX, tileY, offsetMx, offsetMy, text) {
        super();
        this.tileX = tileX;
        this.tileY = tileY;
        this.offsetMx = offsetMx;
        this.offsetMy = offsetMy;
        this.text = text;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return tileInBounds(this.tileX, this.tileY)
            && noteOffsetValid(this.offsetMx)
            && noteOffsetValid(this.offsetMy)
            && noteTextValid(this.text);
    }
}

/**
 * Rewrites the text of the note on a tile; only its author may.
 */
export class NoteEditMessage extends AbstractMessage {

    static wireFields = {
        tileX: "sint32",
        tileY: "sint32",
        text: "string",
    };

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} text
     */
    constructor(tileX, tileY, text) {
        super();
        this.tileX = tileX;
        this.tileY = tileY;
        this.text = text;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return tileInBounds(this.tileX, this.tileY) && noteTextValid(this.text);
    }
}

/**
 * Removes the note on a tile; its author or anyone with build rights on the chunk may.
 */
export class NoteDeleteMessage extends AbstractMessage {

    static wireFields = {
        tileX: "sint32",
        tileY: "sint32",
    };

    /**
     * @param {number} tileX
     * @param {number} tileY
     */
    constructor(tileX, tileY) {
        super();
        this.tileX = tileX;
        this.tileY = tileY;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return tileInBounds(this.tileX, this.tileY);
    }
}
