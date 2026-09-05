import {AbstractMessage, TILE_HALF} from "@spup/sdk";

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
        // The region's half-open tile box, matching tileId's bounds.
        return Number.isFinite(this.x) && Number.isFinite(this.y)
            && this.x >= -TILE_HALF && this.x < TILE_HALF
            && this.y >= -TILE_HALF && this.y < TILE_HALF;
    }
}

/**
 * Hides the sender's cursor: sent on window blur or zoom-out past world mode.
 */
export class CursorHideMessage extends AbstractMessage {

    static wireFields = {};
}
