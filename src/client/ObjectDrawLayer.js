import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {ChunkNode} from "@/client/ChunkNode.js";
import {TILE_SIZE, sameChunks} from "@/client/constants.js";
import {chunkId} from "@/common/util.js";
import {MAP_TILE_COLOR} from "@/client/Theme.js";
import {ObjectClientData} from "@/client/ClientCacheSync.js";
import {ObjectSprite} from "@/client/ObjectSprite.js";

/**
 * Renders one object type's placed sprites off the shared cache: ClientCacheSync owns the entries,
 * this layer mirrors them (a pure renderer — it never writes the cache). Bespoke rendering (belts)
 * hand-rolls a layer instead.
 *
 * Children are grouped per chunk so mounting and unmounting cost one operation per chunk rather
 * than one per sprite — pixi's removeChild is a linear scan of the parent's children.
 */
export class ObjectDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ObjectType} type
     */
    constructor(type) {
        super();
        this._type = type;
        this._objects = {};
        this._chunks = new Map();
        // The chunks whose roots are mounted, and those whose pooled geometry is stale.
        this._mounted = new Set();
        this._dirtyChunks = new Set();
        this._visibleChunks = new Set();
        this._mapMode = false;
    }

    get layerIndex() {
        return this._type.drawLayerIndex;
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
     * Swaps every mounted chunk between full sprites and pooled map geometry.
     * @param {boolean} value
     */
    set mapMode(value) {
        if (value === this._mapMode) {
            return;
        }
        this._mapMode = value;
        for (const chunk of this._mounted) {
            this._applyMode(chunk);
        }
    }

    /**
     * @param {number} id
     * @param {Sprite} sprite
     */
    addObject(id, sprite) {
        this._objects[id] = sprite;

        const chunk = chunkId(sprite.tileX, sprite.tileY);
        this._node(chunk).sprites.addChild(sprite);
        this._dirtyChunks.add(chunk);

        if (this._visibleChunks.has(chunk)) {
            this._mountChunk(chunk);
        }
    }

    /**
     * @param {number} id
     */
    removeObject(id) {
        const sprite = this._objects[id];

        if (sprite === undefined) {
            return;
        }

        const chunk = chunkId(sprite.tileX, sprite.tileY);
        // Scans only its own chunk's children, and detaches from its parent.
        sprite.destroy();
        delete this._objects[id];
        this._dirtyChunks.add(chunk);

        const node = this._chunks.get(chunk);
        if (node !== undefined && node.isEmpty) {
            this._unmountChunk(chunk);
            node.destroy();
            this._chunks.delete(chunk);
            this._dirtyChunks.delete(chunk);
        }
    }

    /**
     * Reconciles mounted chunks against the viewport and pending object changes, then advances
     * every on-screen sprite to the shared animation frame (map mode draws no sprites).
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks the chunks the viewport covers this frame
     */
    tick(frame, deltaMS, visibleChunks) {
        this._reconcileViewport(visibleChunks);
        if (this._mapMode) {
            this._flushDirtyChunks();
            return;
        }
        for (const chunk of this._mounted) {
            for (const sprite of this._chunks.get(chunk).spriteList) {
                sprite.tick(frame);
            }
        }
    }

    /**
     * Mounts the chunks that panned into view and unmounts those that panned out.
     * @param {Set<number>} visible the chunks the viewport covers this frame
     * @returns {void}
     * @private
     */
    _reconcileViewport(visible) {
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
     * Rebuilds the pooled geometry of every mounted chunk an object change invalidated.
     * @returns {void}
     * @private
     */
    _flushDirtyChunks() {
        if (this._dirtyChunks.size === 0) {
            return;
        }
        for (const chunk of this._dirtyChunks) {
            if (this._mounted.has(chunk)) {
                this._buildChunkGeometry(chunk);
            }
        }
        this._dirtyChunks.clear();
    }

    /**
     * The chunk's node, created empty on first use.
     * @param {number} chunk
     * @returns {ChunkNode}
     * @private
     */
    _node(chunk) {
        let node = this._chunks.get(chunk);
        if (node === undefined) {
            node = new ChunkNode();
            this._chunks.set(chunk, node);
        }
        return node;
    }

    /**
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _mountChunk(chunk) {
        const node = this._chunks.get(chunk);
        if (node === undefined || this._mounted.has(chunk)) {
            return;
        }
        this._mounted.add(chunk);
        this._applyMode(chunk);
        this.addChild(node.root);
    }

    /**
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _unmountChunk(chunk) {
        if (!this._mounted.has(chunk)) {
            return;
        }
        this.removeChild(this._chunks.get(chunk).root);
        this._mounted.delete(chunk);
    }

    /**
     * Hangs the current mode's node under the chunk root, detaching the other one.
     * @param {number} chunk
     * @returns {void}
     * @private
     */
    _applyMode(chunk) {
        const node = this._chunks.get(chunk);

        if (this._mapMode) {
            node.showGraphics(this._buildChunkGeometry(chunk));
            return;
        }
        node.showSprites();
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

        const node = this._chunks.get(chunk);
        if (node.graphics === null) {
            node.graphics = new Graphics();
        } else {
            node.graphics.clear();
        }

        for (const sprite of node.spriteList) {
            for (const cell of this._type.geometry.tiles(sprite.direction)) {
                node.graphics.rect(
                    (sprite.tileX + cell.x) * TILE_SIZE,
                    (sprite.tileY + cell.y) * TILE_SIZE,
                    TILE_SIZE,
                    TILE_SIZE,
                );
            }
        }
        node.graphics.fill(this._type.mapColor !== null ? this._type.mapColor : MAP_TILE_COLOR);
        return node.graphics;
    }
}
