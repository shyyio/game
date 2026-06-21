
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
     */
    constructor(session) {
        this.session = session;
    }

    /**
     * @abstract
     * @returns {string}
     */
    get label() {}

    /**
     * @abstract
     * Called when the user taps (clicks without dragging) a tile.
     * @param {number} x - tile x
     * @param {number} y - tile y
     */
    onTap(x, y) {}

    /**
     * @abstract
     * Called once per tile entered during a drag.
     * Each call moves exactly one tile in a cardinal direction.
     * @param {number} x - destination tile x
     * @param {number} y - destination tile y
     * @param {Direction} direction - the step direction (UP / RIGHT / DOWN / LEFT)
     */
    onDragTile(x, y, direction) {}
}
