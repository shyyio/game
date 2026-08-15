import {AbstractEvent, AbstractChunkRoutedEvent} from "@spup/sdk";

/**
 * A player's cursor at a tile position (fractional); routed to the sessions viewing its chunk.
 */
export class PlayerCursorEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        playerId: "int64",
        x: "float",
        y: "float",
    };

    /**
     * @param {number} playerId
     * @param {number} x tile x, fractional
     * @param {number} y tile y, fractional
     */
    constructor(playerId, x, y) {
        super(x, y);
        this.playerId = playerId;
    }
}

/**
 * A player's cursor went away (blur, zoom-out, chunk crossing, share-off, disconnect). Targeted
 * (publishTo) at the sessions losing sight of it.
 */
export class PlayerCursorHideEvent extends AbstractEvent {

    static wireFields = {
        playerId: "int64",
    };

    /**
     * @param {number} playerId
     */
    constructor(playerId) {
        super();
        this.playerId = playerId;
    }
}
