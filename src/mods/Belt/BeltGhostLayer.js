import {AbstractDrawLayer, Texture, currentAnimationFrame} from "@/sdk/client.js";
import {BeltBend} from "./constants.js";
import {BeltSprite, beltFrameName} from "./BeltLayer.js";

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
        const texture = this.textureRegistry.get(beltFrameName(bend, beltType, currentAnimationFrame()));
        const sprite = new BeltSprite(
            0,
            tileX,
            tileY,
            direction,
            bend,
            beltType,
            texture === undefined ? Texture.EMPTY : texture,
        );
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
        const texture = this.textureRegistry.get(beltFrameName(this._sprite.bend, this._sprite.type, frame));
        this._sprite.texture = texture === undefined ? Texture.EMPTY : texture;
    }
}
