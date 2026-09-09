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
