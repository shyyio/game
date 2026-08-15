import {TILE_SIZE} from "@spup/sdk/client";
import {NOTE_OFFSET_CENTER, NOTE_OFFSET_UNITS} from "../common/constants.js";

/**
 * A note's marker position in world pixels; map mode parks every marker on its tile center.
 * @param {{tileX: number, tileY: number, offsetMx: number, offsetMy: number}} note
 * @param {boolean} [mapMode]
 * @returns {{x: number, y: number}}
 */
export function noteAnchor(note, mapMode) {
    let offsetMx = note.offsetMx;
    let offsetMy = note.offsetMy;
    if (mapMode === true) {
        offsetMx = NOTE_OFFSET_CENTER;
        offsetMy = NOTE_OFFSET_CENTER;
    }
    return {
        x: (note.tileX + offsetMx / NOTE_OFFSET_UNITS) * TILE_SIZE,
        y: (note.tileY + offsetMy / NOTE_OFFSET_UNITS) * TILE_SIZE,
    };
}

/**
 * Keeps a value inside a range; a range narrower than the value collapses to its low end.
 * @param {number} value
 * @param {number} low
 * @param {number} high
 * @returns {number}
 */
export function clamp(value, low, high) {
    return Math.min(Math.max(value, low), Math.max(low, high));
}
