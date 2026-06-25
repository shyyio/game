import {Direction} from "@/common/constants.js";
import {NotImplementedError} from "@/common/error.js";

/**
 * @abstract
 *
 * Contract: onDragTile is called at most once per tile per drag, and always
 * moves exactly one step in a cardinal direction (never diagonal).
 * Enforcement is the InputHandler's responsibility.
 */
export class AbstractTool {

    /**
     * @param {AbstractSession} session
     */
    constructor(session) {
        this.session = session;
        // Orientable tools assign the shared ToolRotation here so the placement
        // facing persists across tool switches; tools with no orientation leave it
        // null and rotate() is a no-op for them.
        this._rotation = null;
    }

    /**
     * @abstract
     * @returns {string}
     */
    get label() {
        throw new NotImplementedError();
    }

    /**
     * Called when the user taps (clicks without dragging) a tile.
     * @abstract
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    onTap(tileX, tileY) {
        throw new NotImplementedError();
    }

    /**
     * Called when a drag gesture begins, before onDragTile.
     * @param {number} tileX
     * @param {number} tileY
     */
    onDragStart(tileX, tileY) {}

    /**
     * Called once per tile entered during a drag, one cardinal step at a time.
     * @abstract
     * @param {number} tileX - destination tile x
     * @param {number} tileY - destination tile y
     * @param {Direction} direction - the step direction (UP / RIGHT / DOWN / LEFT)
     * @returns {void}
     */
    onDragTile(tileX, tileY, direction) {
        throw new NotImplementedError();
    }

    /**
     * Optional hover hook: the cursor entered a tile (desktop only), for a ghost preview.
     * @param {number} tileX
     * @param {number} tileY
     */
    onTileEnter(tileX, tileY) {}

    /**
     * Optional hover hook: the cursor left a tile, pairing with onTileEnter.
     * @param {number} tileX
     * @param {number} tileY
     */
    onTileExit(tileX, tileY) {}

    /**
     * Rotates the facing by `rotation` clockwise quarter-turns; a no-op for tools with
     * no orientation (`_rotation` unset).
     * @param {number} rotation
     * @returns {void}
     */
    rotate(rotation) {
        if (this._rotation != null) {
            this._rotation.rotate(rotation);
        }
    }
}
