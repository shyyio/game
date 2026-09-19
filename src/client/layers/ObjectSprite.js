import {Sprite, Texture} from "pixi.js";
import {TILE_SIZE} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";

// World pixels the machine body stands above the frame it sits on.
export const BODY_DRAW_HEIGHT = 16;

/**
 * A type's body frames: its animation sequence, or its still as a one-frame sequence, or null when
 * it has no body art.
 * @param {TextureCache} textureCache
 * @param {ObjectType} type
 * @returns {Texture[]|null}
 */
export function getBodyFramesOrNull(textureCache, type) {
    if (type.bodyAnimationName !== null) {
        return textureCache.getAnimation(type.bodyAnimationName);
    }
    if (type.bodyTextureName === null) {
        return null;
    }
    return [textureCache.get(type.bodyTextureName)];
}

/**
 * Object sprite, centered on its type's geometry and rotated to its facing. The derived Object
 * layers build it from a type + texture; an animated body cycles its own frames off the shared
 * clock and rests on its first frame while stalled, and custom art (belts) is bespoke.
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
     * @param [config.bodyFrames] {Texture[]|null} already resolved; drawn over the frame, cycled
     *     off the shared clock
     * @param [config.isStalled] {boolean} whether the body rests on its first frame
     */
    constructor({
        id,
        tileX,
        tileY,
        direction,
        texture,
        type,
        bodyFrames=null,
        isStalled=false,
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

        /**
         * @type {Texture[]|null}
         * @private
         */
        this._bodyFrames = bodyFrames;
        /**
         * Whether the object rests on its first body frame instead of cycling.
         * @type {boolean}
         */
        this.isStalled = isStalled;

        /** @type {Sprite|null} */
        this.body = null;
        if (bodyFrames !== null) {
            this.body = new Sprite(bodyFrames[0]);
            this.body.anchor = 0.5;
            this.body.position.set(0, -BODY_DRAW_HEIGHT);
            this.addChild(this.body);
        }
    }

    /**
     * Draws the animated body's frame for this instant; a static body ignores the call.
     * @param {number} frame the shared clock's frame
     * @returns {void}
     */
    tick(frame) {
        if (this._bodyFrames === null) {
            return;
        }
        if (this.isStalled) {
            this.body.texture = this._bodyFrames[0];
        } else {
            this.body.texture = this._bodyFrames[frame % this._bodyFrames.length];
        }
    }

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
