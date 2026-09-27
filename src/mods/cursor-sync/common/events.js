import {AbstractEvent, AbstractChunkRoutedEvent} from "@spup/sdk";

/**
 * A player's cursor at a tile position (fractional); routed to the sessions viewing its chunk.
 */
export class PlayerCursorEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        playerRef: "int64",
        x: "float",
        y: "float",
    };

    /**
     * @param {number} playerRef
     * @param {number} x tile x, fractional
     * @param {number} y tile y, fractional
     */
    constructor(playerRef, x, y) {
        super(x, y);
        this.playerRef = playerRef;
    }
}

/**
 * A player's cursor went away (blur, zoom-out, chunk crossing, share-off, disconnect). Targeted
 * (publishTo) at the sessions losing sight of it.
 */
export class PlayerCursorHideEvent extends AbstractEvent {

    static wireFields = {
        playerRef: "int64",
    };

    /**
     * @param {number} playerRef
     */
    constructor(playerRef) {
        super();
        this.playerRef = playerRef;
    }
}

/**
 * A player's open selection: its fixed corner (fractional tile) and the tool spanning it.
 */
export class PlayerSelectionStartEvent extends AbstractEvent {

    static wireFields = {
        playerRef: "int64",
        x: "float",
        y: "float",
        toolId: "int32",
    };

    /**
     * @param {number} playerRef
     * @param {number} x tile x, fractional
     * @param {number} y tile y, fractional
     * @param {number} toolId
     */
    constructor(playerRef, x, y, toolId) {
        super();
        this.playerRef = playerRef;
        this.x = x;
        this.y = y;
        this.toolId = toolId;
    }
}

/**
 * A player's selection closed.
 */
export class PlayerSelectionEndEvent extends AbstractEvent {

    static wireFields = {
        playerRef: "int64",
    };

    /**
     * @param {number} playerRef
     */
    constructor(playerRef) {
        super();
        this.playerRef = playerRef;
    }
}

/**
 * One row's filled stretch of a paste mask, relative to its bounds' corner.
 * @typedef {Object} RowRun
 * @property {number} tileX
 * @property {number} tileY
 * @property {number} tileLength
 */

/**
 * The blueprint a player holds to paste, as the cell mask of its {@link CursorPasteMessage}.
 */
export class PlayerPasteEvent extends AbstractEvent {

    static wireFields = {
        playerRef: "int64",
        tileWidth: "int32",
        runs: "int32[]",
    };

    /**
     * @param {number} playerRef
     * @param {number} tileWidth
     * @param {number[]} runs alternating empty and filled lengths, row-major, starting with empty
     */
    constructor(playerRef, tileWidth, runs) {
        super();
        this.playerRef = playerRef;
        this.tileWidth = tileWidth;
        this.runs = runs;
    }

    /**
     * The mask's rows down to its last filled cell.
     * @returns {number}
     */
    get tileHeight() {
        let cellCount = 0;
        for (const run of this.runs) {
            cellCount += run;
        }
        return Math.ceil(cellCount / this.tileWidth);
    }

    /**
     * The filled runs cut at the row edges.
     * @returns {RowRun[]}
     */
    getRowRuns() {
        const rowRuns = [];
        let cellIndex = 0;
        for (let index = 0; index < this.runs.length; index += 2) {
            cellIndex += this.runs[index];
            let remaining = this.runs[index + 1];
            while (remaining > 0) {
                const tileX = cellIndex % this.tileWidth;
                const tileLength = Math.min(remaining, this.tileWidth - tileX);
                rowRuns.push({tileX, tileY: Math.floor(cellIndex / this.tileWidth), tileLength});
                cellIndex += tileLength;
                remaining -= tileLength;
            }
        }
        return rowRuns;
    }
}

/**
 * A player no longer holds a blueprint to paste.
 */
export class PlayerPasteClearEvent extends AbstractEvent {

    static wireFields = {
        playerRef: "int64",
    };

    /**
     * @param {number} playerRef
     */
    constructor(playerRef) {
        super();
        this.playerRef = playerRef;
    }
}
