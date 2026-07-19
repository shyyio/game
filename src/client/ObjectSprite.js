import {Sprite, Texture} from "pixi.js";
import {TILE_SIZE} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";

/**
 * Static object sprite, centered on its type's geometry and rotated to its facing. The derived
 * Object layers build it from a type + texture; animated/custom art (belts) is bespoke.
 */
export class ObjectSprite extends Sprite {

    /**
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {Texture} texture - already resolved
     * @param {ObjectType} type - for the geometry the sprite centers on
     */
    constructor(id, x, y, direction, texture, type) {
        super(texture);

        this.id = id;
        this.tileX = x;
        this.tileY = y;
        this.direction = direction;
        this.anchor = 0.5;
        this.angle = Direction.angle(direction);

        // Center on the geometry's centroid: a 1x1 sits on its tile, a 1x2 on its midpoint.
        const cells = type.geometry.tiles(direction);
        const sum = cells.reduce((acc, cell) => ({x: acc.x + cell.x, y: acc.y + cell.y}), {x: 0, y: 0});
        this.position.set(
            (x + sum.x / cells.length) * TILE_SIZE + TILE_SIZE / 2,
            (y + sum.y / cells.length) * TILE_SIZE + TILE_SIZE / 2,
        );
    }

    /**
     * No-op: an easy object sprite is a single static frame.
     * @param {number} frame
     * @returns {void}
     */
    tick(frame) {}

    /**
     * Renders this sprite as a placement-preview ghost in the given tint and alpha.
     * @param {number} tint
     * @param {number} [alpha]
     */
    setGhost(tint, alpha=1) {
        this.tint = tint;
        this.alpha = alpha;
    }
}
