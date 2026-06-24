import {AbstractDrawLayer, currentAnimationFrame} from "@/sdk/client.js";
import {BeltBend} from "./constants.js";
import {BeltSprite, beltFrameBase} from "./BeltLayer.js";

/**
 * Renders a single semi-transparent "ghost" belt/ramp sprite at the tile a belt
 * tool is hovering, previewing what a tap would place. Driven directly by the
 * tools (showGhost / clear) rather than by game events, so the tools never touch
 * the texture registry or build sprites of their own. The registry is injected
 * by Client.init, like every other draw layer.
 */
export class BeltGhostLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._sprite = null;
    }

    get layerIndex() {
        return 200;
    }

    onEvent(event) {
        // No-op: the ghost reacts to tool hover, not to game journal events.
    }

    /**
     * Shows (or moves) the ghost at the given tile, facing `direction`.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {BeltType} beltType
     */
    showGhost(tileX, tileY, direction, beltType) {
        this.clear();

        // A ghost has no parent context yet, so it always previews as straight.
        const bend = BeltBend.STRAIGHT;
        const frames = this.textureRegistry.getAnimation(beltFrameBase(bend, beltType));
        const sprite = new BeltSprite(
            0,
            tileX,
            tileY,
            direction,
            bend,
            beltType,
            frames,
        );
        sprite.setAnimationFrame(currentAnimationFrame());
        sprite.ghost = true;

        this._sprite = sprite;
        this.addChild(sprite);
    }

    clear() {
        if (this._sprite === null) {
            return;
        }
        this._sprite.destroy();
        this.removeChild(this._sprite);
        this._sprite = null;
    }

    /**
     * Keeps the ghost preview on the shared animation frame.
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        if (this._sprite === null) {
            return;
        }
        this._sprite.setAnimationFrame(frame);
    }
}
