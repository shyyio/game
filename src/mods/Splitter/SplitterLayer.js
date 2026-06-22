import {Sprite, Texture} from "pixi.js";
import {Direction} from "@/common/constants.js";
import {TILE_SIZE} from "@/constants.js";
import {ObjectDrawLayer} from "@/client/ObjectDrawLayer.js";

export class SplitterDrawLayer extends ObjectDrawLayer {

    onEvent(event) {
        // TODO: handle splitter insert/delete events
    }

    /**
     * @param {{id: BigInt, x: number, y: number, direction: Direction}} attrs
     */
    addSplitter(attrs) {
        const texture = this.textureSet
            ? this.textureSet.get("splitter")
            : Texture.EMPTY; // TODO: define canonical splitter texture frame name
        const sprite = new SplitterSprite(attrs, texture);
        this.addObject(attrs.id, sprite);
    }
}

class SplitterSprite extends Sprite {

    /**
     * @param {{id: BigInt, x: number, y: number, direction: Direction}} attrs
     * @param {Texture} texture
     */
    constructor(attrs, texture) {
        super(texture);

        this.id = attrs.id;
        this.tileX = attrs.x;
        this.tileY = attrs.y;
        this.x = attrs.x * TILE_SIZE + 32;
        this.y = attrs.y * TILE_SIZE + 32;
        this.anchor = {x: 0.25, y: 0.50};
        this.angle = Direction.angle(attrs.direction);
        this.direction = attrs.direction;
    }

    set ghost(value) {
        if (value === true) {
            this.alpha = 0.4;
            this.tint = 0xC8F902;
        } else {
            this.alpha = 1;
            this.tint = 0xFFFFFF;
        }
    }

    update(x, y, direction) {
        this.direction = direction;
        this.angle = Direction.angle(direction);
        this.tileX = x;
        this.tileY = y;
        this.x = x * TILE_SIZE + 32;
        this.y = y * TILE_SIZE + 32;
    }

    tick(ticker) {

    }
}
