import {Sprite, Texture, TILE_SIZE, Direction, AbstractDrawLayer} from "@/sdk/client.js";

// Hard-coded item sprite for now.
const ITEM_TEXTURE = "items/2";

/**
 * Renders belt items, keyed by item id. Driven imperatively by BeltClientMod, which
 * resolves the tick's item events to a belt tile.
 */
export class BeltItemDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        /**
         * Live item sprites, keyed by item id.
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
     * Places or repositions an item's sprite at a belt tile and half-tile offset.
     * @param {BigInt} id
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} halfTile
     * @param {Direction} direction
     */
    moveItem(id, tileX, tileY, halfTile, direction) {
        let sprite = this._items[id];
        if (sprite === undefined) {
            sprite = new ItemSprite(id, this.textureRegistry.get(ITEM_TEXTURE));
            this.addChild(sprite);
            this._items[id] = sprite;
        }
        sprite.moveTo(tileX, tileY, halfTile, direction);
    }

    /**
     * Drops an item's sprite; a no-op for an unknown id.
     * @param {BigInt} id
     */
    removeItem(id) {
        const sprite = this._items[id];
        if (sprite === undefined) {
            return;
        }
        sprite.destroy();
        this.removeChild(sprite);
        delete this._items[id];
    }
}

class ItemSprite extends Sprite {

    /**
     * @param {BigInt} id
     * @param {Texture} texture
     */
    constructor(id, texture) {
        super(texture === undefined ? Texture.EMPTY : texture);
        this.id = id;
        this.anchor = 0.5;
    }

    /**
     * Snaps the sprite to a belt tile, offset onto the upstream half when straddling.
     * @param {number} tileX
     * @param {number} tileY
     * @param {boolean} halfTile
     * @param {Direction} direction
     */
    moveTo(tileX, tileY, halfTile, direction) {
        this.x = tileX * TILE_SIZE + ItemSprite._offsetX(halfTile, direction);
        this.y = tileY * TILE_SIZE + ItemSprite._offsetY(halfTile, direction);
    }

    /**
     * @param {boolean} halfTile
     * @param {Direction} direction
     * @returns {number}
     * @private
     */
    static _offsetX(halfTile, direction) {
        if (!halfTile) {
            return TILE_SIZE / 2;
        }
        // Upstream edge, opposite the flow.
        if (direction === Direction.RIGHT) {
            return 0;
        }
        if (direction === Direction.LEFT) {
            return TILE_SIZE;
        }
        return TILE_SIZE / 2;
    }

    /**
     * @param {boolean} halfTile
     * @param {Direction} direction
     * @returns {number}
     * @private
     */
    static _offsetY(halfTile, direction) {
        if (!halfTile) {
            return TILE_SIZE / 2;
        }
        // Upstream edge, opposite the flow.
        if (direction === Direction.UP) {
            return TILE_SIZE;
        }
        if (direction === Direction.DOWN) {
            return 0;
        }
        return TILE_SIZE / 2;
    }
}
