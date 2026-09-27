import {AbstractMessage, TILE_HALF} from "@spup/sdk";
import {MAX_PASTE_CELLS} from "./constants.js";

/**
 * Whether a fractional tile position is finite and inside the region's half-open tile box,
 * matching tileKey's bounds.
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isTilePositionInRegion(x, y) {
    return Number.isFinite(x) && Number.isFinite(y)
        && x >= -TILE_HALF && x < TILE_HALF
        && y >= -TILE_HALF && y < TILE_HALF;
}

/**
 * The sender's cursor heartbeat: its tile position (fractional), sent per interval while the
 * cursor moves.
 */
export class CursorMoveMessage extends AbstractMessage {

    static wireFields = {
        x: "float",
        y: "float",
    };

    /**
     * @param {number} x tile x, fractional
     * @param {number} y tile y, fractional
     */
    constructor(x, y) {
        super();
        this.x = x;
        this.y = y;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return isTilePositionInRegion(this.x, this.y);
    }
}

/**
 * Hides the sender's cursor: sent on window blur or zoom-out past world mode.
 */
export class CursorHideMessage extends AbstractMessage {

    static wireFields = {};
}

/**
 * The sender opened a selection: its fixed corner (fractional tile) and the tool spanning it; the
 * other corner is the sender's cursor.
 */
export class CursorSelectionStartMessage extends AbstractMessage {

    static wireFields = {
        x: "float",
        y: "float",
        toolId: "int32",
    };

    /**
     * @param {number} x tile x, fractional
     * @param {number} y tile y, fractional
     * @param {number} toolId
     */
    constructor(x, y, toolId) {
        super();
        this.x = x;
        this.y = y;
        this.toolId = toolId;
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return isTilePositionInRegion(this.x, this.y);
    }
}

/**
 * The sender's selection closed.
 */
export class CursorSelectionEndMessage extends AbstractMessage {

    static wireFields = {};
}

/**
 * The blueprint the sender holds to paste, as a cell mask over its bounds: alternating empty and
 * filled run lengths in row-major order, starting with empty. The bounds pin on the sender's cursor.
 */
export class CursorPasteMessage extends AbstractMessage {

    static wireFields = {
        tileWidth: "int32",
        runs: "int32[]",
    };

    /**
     * @param {Blueprint} blueprint
     * @param {ModRegistry} modRegistry
     */
    constructor(blueprint, modRegistry) {
        super();
        const bounds = blueprint.getBounds(modRegistry);
        this.tileWidth = bounds.maxTileX - bounds.minTileX + 1;
        const cellIndexes = new Set();
        for (const entry of blueprint.entries) {
            const type = modRegistry.getObjectTypeByTypeId(entry.objectTypeId);
            for (const cell of type.geometry.getTilesByDirection(entry.direction)) {
                cellIndexes.add((entry.tileY + cell.y - bounds.minTileY) * this.tileWidth + entry.tileX + cell.x - bounds.minTileX);
            }
        }
        this.runs = [];
        let filledEnd = 0;
        for (const cellIndex of Array.from(cellIndexes).sort((a, b) => a - b)) {
            if (cellIndex === filledEnd && this.runs.length > 0) {
                this.runs[this.runs.length - 1] += 1;
            } else {
                this.runs.push(cellIndex - filledEnd);
                this.runs.push(1);
            }
            filledEnd = cellIndex + 1;
        }
    }

    /**
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        if (this.tileWidth < 1 || this.runs.length === 0 || this.runs.length % 2 !== 0) {
            return false;
        }
        let filledCount = 0;
        for (let index = 0; index < this.runs.length; index += 2) {
            if (this.runs[index] < 0 || this.runs[index + 1] < 1) {
                return false;
            }
            filledCount += this.runs[index + 1];
        }
        return filledCount <= MAX_PASTE_CELLS;
    }
}

/**
 * The sender no longer holds a blueprint to paste.
 */
export class CursorPasteClearMessage extends AbstractMessage {

    static wireFields = {};
}
