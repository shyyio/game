import {Sprite, Texture} from "pixi.js";
import {TILE_SIZE} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";

// World pixels the machine body stands above the frame it sits on.
export const BODY_DRAW_HEIGHT = 16;

/**
 * @param {TextureCache} textureCache
 * @param {ObjectType} type
 * @returns {Texture|null}
 */
export function getBodyTextureOrNull(textureCache, type) {
    if (type.bodyTextureName === null) {
        return null;
    }
    return textureCache.get(type.bodyTextureName);
}

/**
 * Static object sprite, centered on its type's geometry and rotated to its facing. The derived
 * Object layers build it from a type + texture; animated/custom art (belts) is bespoke.
 */
export class ObjectSprite extends Sprite {

    /**
     * @param {Object} config
     * @param config.id {number}
     * @param config.tileX {number}
     * @param config.tileY {number}
     * @param config.direction {Direction}
     * @param config.texture {Texture} already resolved
     * @param config.type {ObjectType} for the geometry the sprite centers on
     * @param [config.bodyTexture] {Texture|null} already resolved; drawn over the frame
     */
    constructor({
        id,
        tileX,
        tileY,
        direction,
        texture,
        type,
        bodyTexture=null,
    }) {
        super(texture);

        this.id = id;
        this.tileX = tileX;
        this.tileY = tileY;
        this.direction = direction;
        this.anchor = 0.5;
        this.angle = Direction.angle(direction);

        // Center on the geometry's centroid: a 1x1 sits on its tile, a 1x2 on its midpoint.
        const cells = type.geometry.getTilesByDirection(direction);
        const sum = cells.reduce((acc, cell) => ({x: acc.x + cell.x, y: acc.y + cell.y}), {x: 0, y: 0});
        this.position.set(
            (tileX + sum.x / cells.length) * TILE_SIZE + TILE_SIZE / 2,
            (tileY + sum.y / cells.length) * TILE_SIZE + TILE_SIZE / 2,
        );

        /** @type {Sprite|null} */
        this.body = null;
        if (bodyTexture !== null) {
            this.body = new Sprite(bodyTexture);
            this.body.anchor = 0.5;
            this.body.position.set(0, -BODY_DRAW_HEIGHT);
            this.addChild(this.body);
        }
    }

    /**
     * No-op: an easy object sprite is a single static frame.
     * @param {number} frame
     * @returns {void}
     */
    tick(frame) {}

    /**
     * Renders this sprite as a placement-preview ghost in the given tint and alpha. The body child
     * inherits both.
     * @param {number} tint
     * @param {number} [alpha]
     */
    setGhost(tint, alpha=1) {
        this.tint = tint;
        this.alpha = alpha;
    }
}
