import {Sprite, Texture, TILE_SIZE, Direction, AbstractDrawLayer} from "@/sdk/client.js";

// Hard-coded item sprite for now.
const ITEM_TEXTURE = "items/4";

// Items glide to each new position over this long (the game tick is 600ms, so they
// arrive and briefly rest before the next move).
const MOVE_DURATION_MS = 190;

/**
 * Renders belt items, keyed by item id. Driven imperatively by BeltClientMod, which
 * resolves the tick's item events to a belt tile.
 */
export class BeltItemDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        /**
         * Live sprites, keyed by sprite key — a BigInt row id for belt items, a
         * namespaced string for items resting in out-ports.
         * @type {Object.<string, ItemSprite>}
         * @private
         */
        this._items = {};
    }

    get layerIndex() {
        // Above belts (10), below the debug path overlay (100).
        return 15;
    }

    /**
     * Hides items in map mode.
     * @param {boolean} value
     */
    set lowRes(value) {
        this.visible = !value;
    }

    /**
     * No-op: BeltClientMod drives this layer imperatively.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {}

    /**
     * Advances each item's glide toward its target by the frame's elapsed time.
     * @param {number} frame unused — items move, they don't cycle frames
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     */
    tick(frame, deltaMS) {
        Object.values(this._items).forEach(sprite => sprite.advance(deltaMS));
    }

    /**
     * Places or repositions a sprite at a belt tile and half-tile offset.
     * @param {BigInt|string} key - sprite key (row id for belt items, namespaced string for out-port items)
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} halfTile
     * @param {Direction} sourceDir - toward the belt feeding this one (the input/bend edge)
     */
    moveItem(key, tileX, tileY, halfTile, sourceDir) {
        let sprite = this._items[key];
        if (sprite === undefined) {
            sprite = new ItemSprite(this.textureRegistry.get(ITEM_TEXTURE));
            this.addChild(sprite);
            this._items[key] = sprite;
        }
        sprite.moveTo(tileX, tileY, halfTile, sourceDir);
    }

    /**
     * Drops a sprite; a no-op for an unknown key.
     * @param {BigInt|string} key
     */
    removeItem(key) {
        const sprite = this._items[key];
        if (sprite === undefined) {
            return;
        }
        sprite.destroy();
        this.removeChild(sprite);
        delete this._items[key];
    }
}

class ItemSprite extends Sprite {

    /**
     * @param {Texture} texture
     */
    constructor(texture) {
        super(texture === undefined ? Texture.EMPTY : texture);
        this.anchor = 0.5;
        // Glide state: start/target pixels and ms elapsed into the current move.
        // _startX is null when not gliding (freshly placed or arrived).
        this._startX = null;
        this._startY = null;
        this._targetX = null;
        this._targetY = null;
        this._elapsed = 0;
    }

    /**
     * Aims the sprite at a belt tile. When straddling (half-tile) it sits a half-tile
     * toward `sourceDir` — the belt feeding this one — so on a bend it lands on the
     * input edge, not simply opposite the flow. A new item glides in from a further
     * half-tile that way; later moves glide from the sprite's current position.
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} halfTile
     * @param {Direction} sourceDir - toward the source (parent) belt
     */
    moveTo(tileX, tileY, halfTile, sourceDir) {
        const half = TILE_SIZE / 2;
        const sdx = Direction.dx(sourceDir);
        const sdy = Direction.dy(sourceDir);
        const targetX = tileX * TILE_SIZE + half + (halfTile ? sdx * half : 0);
        const targetY = tileY * TILE_SIZE + half + (halfTile ? sdy * half : 0);
        if (this._targetX === null) {
            // First placement: start a half-tile further toward the source so the item
            // slides in along the flow. On a re-sync this lands the re-created sprite ≈
            // the departed sprite's spot, so it glides on smoothly.
            this.x = targetX + sdx * half;
            this.y = targetY + sdy * half;
            this._startX = this.x;
            this._startY = this.y;
            this._elapsed = 0;
        } else if (targetX !== this._targetX || targetY !== this._targetY) {
            // New target: glide from wherever the sprite currently is (picking up any
            // glide still in flight).
            this._startX = this.x;
            this._startY = this.y;
            this._elapsed = 0;
        }
        this._targetX = targetX;
        this._targetY = targetY;
    }

    /**
     * Advances an in-flight glide toward the target; a no-op once arrived or unplaced.
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     */
    advance(deltaMS) {
        if (this._startX === null) {
            return;
        }
        this._elapsed += deltaMS;
        if (this._elapsed >= MOVE_DURATION_MS) {
            this.x = this._targetX;
            this.y = this._targetY;
            this._startX = null;
            return;
        }
        const t = this._elapsed / MOVE_DURATION_MS;
        this.x = this._startX + t * (this._targetX - this._startX);
        this.y = this._startY + t * (this._targetY - this._startY);
    }
}
