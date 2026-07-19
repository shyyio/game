import {AbstractChunkedDrawLayer} from "@/client/AbstractChunkedDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";
import {chunkId} from "@/common/util.js";
import {MAP_TILE_COLOR} from "@/client/Theme.js";
import {ObjectClientData} from "@/client/ClientCacheSync.js";
import {ObjectSprite} from "@/client/ObjectSprite.js";

/**
 * Renders one object type's placed sprites off the shared cache: ClientCacheSync owns the entries,
 * this layer mirrors them (a pure renderer — it never writes the cache). Bespoke rendering (belts)
 * hand-rolls a layer instead.
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
        if (!(entry.data instanceof ObjectClientData) || entry.data.type.typeId !== this._type.typeId) {
            return;
        }
        this.removeObject(entry.id);
        this.addObject(entry.id, new ObjectSprite(
            entry.id,
            entry.tileX,
            entry.tileY,
            entry.data.direction,
            this.textureRegistry.get(this._type.textureName),
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
     * @param {number} id
     * @param {Sprite} sprite
     */
    addObject(id, sprite) {
        this._objects.set(id, sprite);
        const chunk = chunkId(sprite.tileX, sprite.tileY);
        this._node(chunk).sprites.addChild(sprite);
        this._memberAdded(chunk);
    }

    /**
     * @param {number} id
     */
    removeObject(id) {
        const sprite = this._objects.get(id);
        if (sprite === undefined) {
            return;
        }

        const chunk = chunkId(sprite.tileX, sprite.tileY);
        // Scans only its own chunk's children, and detaches from its parent.
        sprite.destroy();
        this._objects.delete(id);

        const node = this._chunks.get(chunk);
        this._memberRemoved(chunk, node === undefined || node.isEmpty);
    }

    /**
     * Advances every on-screen sprite to the shared animation frame.
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @returns {void}
     */
    _updateSprites(frame, deltaMS) {
        for (const chunk of this._mounted) {
            for (const sprite of this._chunks.get(chunk).spriteList) {
                sprite.tick(frame);
            }
        }
    }

    /**
     * Draws every tile of every object in the chunk into its pooled Graphics.
     * @param {number} chunk
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunk, graphics) {
        for (const sprite of this._chunks.get(chunk).spriteList) {
            for (const cell of this._type.geometry.tiles(sprite.direction)) {
                graphics.rect(
                    (sprite.tileX + cell.x) * TILE_SIZE,
                    (sprite.tileY + cell.y) * TILE_SIZE,
                    TILE_SIZE,
                    TILE_SIZE,
                );
            }
        }
        graphics.fill(this._type.mapColor !== null ? this._type.mapColor : MAP_TILE_COLOR);
    }
}
