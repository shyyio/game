import {AbstractDrawLayer, currentAnimationFrame} from "@/sdk/client.js";
import {BeltBend, BeltType} from "./constants.js";
import {BeltSprite, beltFrameBase} from "./BeltLayer.js";

/**
 * Reveals the buried belts of an underground tunnel on hover; driven imperatively by BeltClientMod.onInspect.
 */
export class BeltOverlayDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this._revealSprites = [];
    }

    get layerIndex() {
        return 100;
    }

    set lowRes(value) {
        this.visible = !value;
    }

    onEvent(event) {
        // No-op: the tunnel reveal reacts to inspect hover, not to journal events.
    }

    /**
     * Reveals the underground belts of a tunnel as a line of buried-belt sprites.
     * @param {{x: number, y: number}[]} tiles tunnel tiles, in order
     * @param {Direction} direction the tunnel's facing
     */
    showUndergroundReveal(tiles, direction) {
        this.clearUndergroundReveal();
        tiles.forEach(tile => {
            const frames = this.textureRegistry.getAnimation(beltFrameBase(BeltBend.STRAIGHT, BeltType.UNDERGROUND));
            const sprite = new BeltSprite(
                0,
                tile.x,
                tile.y,
                direction,
                BeltBend.STRAIGHT,
                BeltType.UNDERGROUND,
                frames,
            );
            sprite.setAnimationFrame(currentAnimationFrame());
            this.addChild(sprite);
            this._revealSprites.push(sprite);
        });
    }

    clearUndergroundReveal() {
        this._revealSprites.forEach(sprite => {
            sprite.destroy();
            this.removeChild(sprite);
        });
        this._revealSprites.splice(0);
    }
}
