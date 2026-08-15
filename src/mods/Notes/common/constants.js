// A note's text, in characters.
export const NOTE_TEXT_MAX_LENGTH = 256;

// Sub-tile anchor resolution: an offset is milli-tiles in [0, NOTE_OFFSET_UNITS).
export const NOTE_OFFSET_UNITS = 1000;
// The anchor a note gets when the pointer position is unknown (touch, center-lock).
export const NOTE_OFFSET_CENTER = NOTE_OFFSET_UNITS / 2;

// The save's record table holding every placed note.
export const NOTE_RECORD = "Note";

// Toolbar identity of the note tool; hand-authored, unique across every tool.
export const NOTE_TOOL_ID = 27;

// C0 and C1 control characters; a note is one rendered line of pixi Text.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Whether a text is acceptable as a note's body.
 * @param {*} text
 * @returns {boolean}
 */
export function noteTextValid(text) {
    if (typeof text !== "string") {
        return false;
    }
    if (text.length === 0 || text.length > NOTE_TEXT_MAX_LENGTH) {
        return false;
    }
    return !CONTROL_CHARACTERS.test(text);
}

/**
 * Whether a sub-tile anchor offset is in range.
 * @param {number} offset milli-tiles
 * @returns {boolean}
 */
export function noteOffsetValid(offset) {
    return Number.isInteger(offset) && offset >= 0 && offset < NOTE_OFFSET_UNITS;
}
