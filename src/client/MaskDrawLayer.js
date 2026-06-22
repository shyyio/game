import {DrawLayer} from "@/client/DrawLayer.js";
import {Sprite} from "pixi.js";

/**
 * A shared mask layer that any DrawLayer can write mask sprites into.
 * Objects that should occlude items add a companion mask sprite here
 * (looked up from TextureRegistry) when they are placed.
 *
 * ItemDrawLayer uses this layer as its pixi mask (inverse=true), so items
 * are hidden wherever a mask sprite covers them.
 */
export class MaskDrawLayer extends DrawLayer {

    constructor() {
        super();
        this._masks = {};
    }

    get layerIndex() {
        return 5;
    }

    onEvent(event) {
        // TODO: handle object place/remove events to add/remove mask sprites
    }

    /**
     * @param {BigInt} id       — owning object id, used to remove later
     * @param {Texture} texture — companion mask texture for this object type
     * @param {number} x        — pixel x
     * @param {number} y        — pixel y
     */
    addMask(id, texture, x, y) {
        const sprite = new Sprite(texture);
        sprite.x = x;
        sprite.y = y;
        this._masks[id] = sprite;
        this.addChild(sprite);
    }

    /**
     * @param {BigInt} id
     */
    removeMask(id) {
        const sprite = this._masks[id];

        if (sprite === undefined) {
            return;
        }

        sprite.destroy();
        this.removeChild(sprite);
        delete this._masks[id];
    }
}
