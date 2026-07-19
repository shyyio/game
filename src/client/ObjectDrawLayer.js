import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE, sameChunks, viewportChunks} from "@/client/constants.js";
import {chunkId} from "@/common/util.js";
import {MAP_TILE_COLOR} from "@/client/Theme.js";
import {ObjectClientData} from "@/client/ClientCacheSync.js";
import {ObjectSprite} from "@/client/ObjectSprite.js";

/**
 * Renders one object type's placed sprites off the shared cache: ClientCacheSync owns the entries,
 * this layer mirrors them (a pure renderer — it never writes the cache). Bespoke rendering (belts)
 * hand-rolls a layer instead.
 *
 * Only the current mode's children of on-screen chunks are mounted: pixi walks every child of a
 * container each frame and bills each Graphics as its own renderable, so map mode pools a whole
 * chunk's tiles into one Graphics rather than one per object.
 */
export class ObjectDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ObjectType} type
     */
    constructor(type) {
        super();
        this._type = type;
        this._objects = {};
        // Object ids per chunk, and the ids whose sprites are mounted (sprite mode).
        this._idsByChunk = new Map();
        this._mounted = new Set();
        // The pooled map-mode geometry per chunk, and the chunks whose geometry is mounted.
        this._mapChunks = new Map();
        this._mountedChunks = new Set();
        // Chunks whose pooled geometry no longer matches their objects.
        this._dirtyChunks = new Set();
        this._visibleChunks = new Set();
        this._mapMode = false;
    }

    get layerIndex() {
        return 20;
    }

    /**
     * Subscribes to the shared cache; the client calls this once when it builds the type's bundle.
     * @param {ClientCache} cache
     * @returns {void}
     */
    bindCache(cache) {
        cache.onSet(entry => this._onSet(entry));
        cache.onRemove(entry => this.removeObject(entry.id));
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        // No-op: a pure renderer, driven by cache listeners.
    }

    /**
     * @private
     * @param {CacheEntry} entry
     * @returns {void}
     */
    _onSet(entry) {
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
     * Swaps the mounted children between full sprites and pooled map geometry.
     * @param {boolean} value
     */
    set mapMode(value) {
        if (value === this._mapMode) {
            return;
        }
        this._unmountAll();
        this._mapMode = value;
        for (const chunk of this._visibleChunks) {
            this._mountChunk(chunk);
        }
    }

    /**
     * @param {number} id
     * @param {Sprite} sprite
     */
    addObject(id, sprite) {
        this._objects[id] = sprite;

        const chunk = chunkId(sprite.tileX, sprite.tileY);
        const ids = this._idsByChunk.get(chunk);
        if (ids === undefined) {
            this._idsByChunk.set(chunk, new Set([id]));
        } else {
            ids.add(id);
        }
        this._dirtyChunks.add(chunk);

        if (this._mapMode || !this._visibleChunks.has(chunk)) {
            return;
        }
        this._mountSprite(id);
    }

    /**
     * @param {number} id
     */
    removeObject(id) {
        const sprite = this._objects[id];

        if (sprite === undefined) {
            return;
        }

        this._unmountSprite(id);

        const chunk = chunkId(sprite.tileX, sprite.tileY);
        const ids = this._idsByChunk.get(chunk);
        if (ids !== undefined) {
            ids.delete(id);
            if (ids.size === 0) {
                this._idsByChunk.delete(chunk);
            }
        }
        this._dirtyChunks.add(chunk);

        sprite.destroy();
        delete this._objects[id];
    }

    /**
     * Reconciles mounted children against the viewport and pending object changes, then advances
     * every on-screen sprite to the shared animation frame (map mode draws no sprites).
     * @param {number} frame animation frame, in [0, 8)
     */
    tick(frame) {
        this._reconcileViewport();
        if (this._mapMode) {
            this._flushDirtyChunks();
            return;
        }
        for (const id of this._mounted) {
            this._objects[id].tick(frame);
        }
    }

    /**
     * Mounts the chunks that panned into view and unmounts those that panned out.
     * @returns {void}
     * @private
     */
    _reconcileViewport() {
        const visible = viewportChunks(this.viewport);
        if (sameChunks(visible, this._visibleChunks)) {
            return;
        }

        for (const chunk of this._visibleChunks) {
            if (!visible.has(chunk)) {
                this._unmountChunk(chunk);
            }
        }

        for (const chunk of visible) {
            if (!this._visibleChunks.has(chunk)) {
                this._mountChunk(chunk);
            }
        }
        this._visibleChunks = visible;
    }

    /**
     * Rebuilds the pooled geometry of every mounted chunk an object change invalidated, and drops
     * the geometry of chunks left empty.
     * @returns {void}
     * @private
     */
    _flushDirtyChunks() {
        if (this._dirtyChunks.size === 0) {
            return;
        }
        for (const chunk of this._dirtyChunks) {
            if (!this._idsByChunk.has(chunk)) {
                this._unmountChunk(chunk);
                const graphics = this._mapChunks.get(chunk);
                if (graphics !== undefined) {
                    graphics.destroy();
                    this._mapChunks.delete(chunk);
                }
            } else if (this._mountedChunks.has(chunk)) {
                this._buildChunkGeometry(chunk);
            } else if (this._visibleChunks.has(chunk)) {
                // Its first object: the chunk had nothing to pool when it scrolled in.
                this._mountChunk(chunk);
            }
        }
        this._dirtyChunks.clear();
    }

    /**
     * Adds one chunk's children for the current mode.
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _mountChunk(chunk) {
        if (!this._mapMode) {
            for (const id of this._chunkIds(chunk)) {
                this._mountSprite(id);
            }
            return;
        }

        if (this._mountedChunks.has(chunk) || !this._idsByChunk.has(chunk)) {
            return;
        }
        this.addChild(this._buildChunkGeometry(chunk));
        this._mountedChunks.add(chunk);
    }

    /**
     * Removes one chunk's children of either mode, keeping them for a later remount.
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _unmountChunk(chunk) {
        for (const id of this._chunkIds(chunk)) {
            this._unmountSprite(id);
        }

        if (!this._mountedChunks.has(chunk)) {
            return;
        }
        this.removeChild(this._mapChunks.get(chunk));
        this._mountedChunks.delete(chunk);
    }

    /**
     * @returns {void}
     * @private
     */
    _unmountAll() {
        for (const id of this._mounted) {
            this.removeChild(this._objects[id]);
        }
        this._mounted.clear();

        for (const chunk of this._mountedChunks) {
            this.removeChild(this._mapChunks.get(chunk));
        }
        this._mountedChunks.clear();
    }

    /**
     * @param {number} id
     * @returns {void}
     * @private
     */
    _mountSprite(id) {
        if (this._mounted.has(id)) {
            return;
        }
        this.addChild(this._objects[id]);
        this._mounted.add(id);
    }

    /**
     * @param {number} id
     * @returns {void}
     * @private
     */
    _unmountSprite(id) {
        if (!this._mounted.has(id)) {
            return;
        }
        this.removeChild(this._objects[id]);
        this._mounted.delete(id);
    }

    /**
     * Redraws one chunk's map-mode geometry: every tile of every object in the chunk, pooled into
     * the chunk's single Graphics.
     * @param {number} chunk
     * @returns {Graphics}
     * @private
     */
    _buildChunkGeometry(chunk) {
        this._dirtyChunks.delete(chunk);

        let graphics = this._mapChunks.get(chunk);
        if (graphics === undefined) {
            graphics = new Graphics();
            this._mapChunks.set(chunk, graphics);
        } else {
            graphics.clear();
        }

        for (const id of this._chunkIds(chunk)) {
            const sprite = this._objects[id];
            for (const cell of this._type.geometry.tiles(sprite.direction)) {
                graphics.rect(
                    (sprite.tileX + cell.x) * TILE_SIZE,
                    (sprite.tileY + cell.y) * TILE_SIZE,
                    TILE_SIZE,
                    TILE_SIZE,
                );
            }
        }
        graphics.fill(MAP_TILE_COLOR);
        return graphics;
    }

    /**
     * @param {number} chunk
     * @returns {Set<number>} the object ids in `chunk`
     * @private
     */
    _chunkIds(chunk) {
        const ids = this._idsByChunk.get(chunk);
        return ids === undefined ? new Set() : ids;
    }
}
