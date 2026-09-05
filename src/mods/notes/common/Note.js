/**
 * One placed note: its tile, its sub-tile anchor in milli-tiles, its author, and its text.
 */
export class Note {

    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} offsetMx sub-tile x offset, milli-tiles
     * @param {number} offsetMy sub-tile y offset, milli-tiles
     * @param {number} authorId
     * @param {string} text
     */
    constructor(
        tileX,
        tileY,
        offsetMx,
        offsetMy,
        authorId,
        text,
    ) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.offsetMx = offsetMx;
        this.offsetMy = offsetMy;
        this.authorId = authorId;
        this.text = text;
    }
}
