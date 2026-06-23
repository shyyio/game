
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
     */
    onTap(tileX, tileY) {
        throw new NotImplementedError();
    }

    /**
     * Called once per tile entered during a drag.
     * Each call moves exactly one tile in a cardinal direction.
     * @abstract
     * @param {number} tileX - destination tile x
     * @param {number} tileY - destination tile y
     * @param {Direction} direction - the step direction (UP / RIGHT / DOWN / LEFT)
     */
    onDragTile(tileX, tileY, direction) {
        throw new NotImplementedError();
    }

    /**
     * Optional hover hook: called when the cursor enters a tile (desktop only;
     * touch input has no hover). Intended for a placement "ghost" preview.
     * Defaults to a no-op so tools without a preview need not override it.
     * @param {number} tileX
     * @param {number} tileY
     */
    onTileEnter(tileX, tileY) {}

    /**
     * Optional hover hook: called when the cursor leaves a tile. Pairs with
     * onTileEnter to clear a placement preview. Defaults to a no-op.
     * @param {number} tileX
     * @param {number} tileY
     */
    onTileExit(tileX, tileY) {}

    /**
     * Optional hook: called after the player picks a direction from the radial
     * direction wheel (long-press while this tool is active). What it does is up
     * to the tool — e.g. place an object facing that direction and remember it.
     * Defaults to a no-op.
     * @param {number} tileX - tile the wheel was opened on
     * @param {number} tileY
     * @param {Direction} direction - the chosen direction
     */
    onLongTap(tileX, tileY, direction) {}

    /**
     * Optional hook: rotate the tool's facing direction one step clockwise (bound
     * to the "r" key). Defaults to a no-op for tools that have no orientation.
     */
    rotate() {}
}
