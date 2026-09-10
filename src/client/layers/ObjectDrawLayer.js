import {AbstractChunkedDrawLayer} from "@/client/layers/AbstractChunkedDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";
import {chunkKeyAt} from "@/common/util.js";
import {MAP_TILE_COLOR} from "@/client/Theme.js";
import {ObjectClientEntry} from "@/client/state/ObjectsState.js";
import {ObjectSprite} from "@/client/layers/ObjectSprite.js";

/**
 * Renders one object type's placed sprites off the shared cache: the objects state owns the
 * entries, this layer mirrors them (a pure renderer — it never writes the cache). Bespoke
 * rendering (belts) hand-rolls a layer instead.
 */
export class ObjectDrawLayer extends AbstractChunkedDrawLayer {

    /**
     * @param {ObjectType} type
     */
    constructor(type) {
        super();
        this._type = type;
        /**
         * @type {Map<number, ObjectSprite>}
         */
        this._objects = new Map();
    }

    get layerIndex() {
        return this._type.drawLayerIndex;
    }

    /**
     * Mirrors a set entry of this layer's type into a fresh sprite.
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheSet(entry) {
        if (!(entry.data instanceof ObjectClientEntry) || entry.data.type.objectTypeId !== this._type.objectTypeId) {
            return;
        }
        this.removeObject(entry.id);
        this.addObject(entry.id, new ObjectSprite(
            entry.id,
            entry.tileX,
            entry.tileY,
            entry.data.direction,
            this.textureCache.get(this._type.getTextureByData(entry.data)),
            this._type,
        ));
    }

    /**
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheRemove(entry) {
        this.removeObject(entry.id);
    }

    /**
     * Re-resolves a patched entry's state-dependent texture.
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheUpdate(entry) {
        if (!(entry.data instanceof ObjectClientEntry) || entry.data.type.objectTypeId !== this._type.objectTypeId) {
            return;
        }
        const sprite = this._objects.get(entry.id);
        if (sprite === undefined) {
            return;
        }
        sprite.texture = this.textureCache.get(this._type.getTextureByData(entry.data));
    }

    /**
     * @param {number} id
     * @param {Sprite} sprite
     */
    addObject(id, sprite) {
        this._objects.set(id, sprite);
        const chunkKey = chunkKeyAt(sprite.tileX, sprite.tileY);
        this._node(chunkKey).sprites.addChild(sprite);
        this._memberAdded(chunkKey);
    }

    /**
     * @param {number} id
     */
    removeObject(id) {
        const sprite = this._objects.get(id);
        if (sprite === undefined) {
            return;
        }

        const chunkKey = chunkKeyAt(sprite.tileX, sprite.tileY);
        // Scans only its own chunk's children, and detaches from its parent.
        sprite.destroy();
        this._objects.delete(id);

        const node = this._chunks.get(chunkKey);
        this._memberRemoved(chunkKey, node === undefined || node.isEmpty);
    }

    /**
     * Advances every on-screen sprite to the shared animation frame.
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @returns {void}
     */
    _drawSprites(frame, deltaMS) {
        for (const chunk of this._mounted) {
            for (const sprite of this._chunks.get(chunk).spriteList) {
                sprite.tick(frame);
            }
        }
    }

    /**
     * Draws every tile of every object in the chunk into its pooled Graphics.
     * @param {number} chunkKey
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunkKey, graphics) {
        for (const sprite of this._chunks.get(chunkKey).spriteList) {
            for (const cell of this._type.geometry.getTilesByDirection(sprite.direction)) {
                graphics.rect(
                    (sprite.tileX + cell.x) * TILE_SIZE,
                    (sprite.tileY + cell.y) * TILE_SIZE,
                    TILE_SIZE,
                    TILE_SIZE,
                );
            }
        }
        let fillColor;
        if (this._type.mapColor !== null) {
            fillColor = this._type.mapColor;
        } else {
            fillColor = MAP_TILE_COLOR;
        }
        graphics.fill(fillColor);
    }
}
