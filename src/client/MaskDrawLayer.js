import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {Sprite, Texture} from "pixi.js";

/**
 * Shared mask layer any draw layer writes occluder sprites into; ItemDrawLayer uses
 * it as an inverse pixi mask to hide items beneath.
 */
export class MaskDrawLayer extends AbstractDrawLayer {

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
