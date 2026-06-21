
import {Direction} from "@/common/constants.js";

/**
 * @abstract
 *
 * Contract: onDragTile is called at most once per tile per drag, and always
 * moves exactly one step in a cardinal direction (never diagonal).
 * Enforcement is the InputHandler's responsibility.
 */
export class Tool {

    /**
     * @param {Session} session
     * @param {Game} game
     */
    constructor(session, game) {
        this.session = session;
        this.game = game;
    }

    /**
     * @abstract
     * @returns {string}
     */
    get label() {}

    /**
     * @abstract
     * Called when the user taps (clicks without dragging) a tile.
     * @param {number} tileX
     * @param {number} tileY
     */
    onTap(tileX, tileY) {}

    /**
     * @abstract
     * Called once per tile entered during a drag.
     * Each call moves exactly one tile in a cardinal direction.
     * @param {number} tileX - destination tile x
     * @param {number} tileY - destination tile y
     * @param {Direction} direction - the step direction (UP / RIGHT / DOWN / LEFT)
     */
    onDragTile(tileX, tileY, direction) {}
}
