import {Direction} from "@/common/constants.js";

/**
 * Shared placement facing for orientable tools, held under the Client so it carries
 * over across tool switches.
 */
export class ToolRotation {

    constructor() {
        this._direction = Direction.UP;
    }

    /**
     * @returns {Direction}
     */
    get direction() {
        return this._direction;
    }

    /**
     * @param {Direction} direction
     */
    set direction(direction) {
        this._direction = direction;
    }

    /**
     * Rotates the facing by `rotation` clockwise quarter-turns.
     * @param {number} rotation
     * @returns {void}
     */
    rotate(rotation) {
        this._direction = Direction.rotate(this._direction, rotation);
    }

    /**
     * Flips the facing 180°.
     * @returns {void}
     */
    invert() {
        this._direction = Direction.invert(this._direction);
    }
}
