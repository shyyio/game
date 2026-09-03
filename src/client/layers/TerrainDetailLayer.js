import {Sprite} from "pixi.js";
import {AbstractChunkedDrawLayer} from "@/client/layers/AbstractChunkedDrawLayer.js";
import {DisplayPool} from "@/client/layers/DisplayPool.js";
import {TILE_SIZE} from "@/client/constants.js";
import {CHUNK_SIZE, LAYER_SURFACE} from "@/common/constants.js";
import {chunkId, chunkOrigin} from "@/common/util.js";
import {tileHash} from "@/common/WorldNoise.js";
import {scaleColor} from "@/client/Theme.js";

// Idle sprites kept across chunk churn.
const POOL_CAPACITY = 4096;
// How far a detail may sit off its tile center, as a fraction of a tile.
const JITTER = 0.2;
// Tinted (grayscale) art takes the biome color darkened by this, so it reads against the ground.
const TINT_DARKEN = 0.8;
const QUARTER_TURN = Math.PI / 2;
const COLOR_CHANNEL_MASK = 0xff;
const BYTE_RANGE = 256;

/**
 * Scatters each biome's TerrainDetails (rocks, shrubs, tufts) over the chunks in view: placement
 * comes from Terrain.detailFor, pose (turn, offset) from a second tile hash, both seeded, so every
 * client sees the same ground. Tiles under a surface object carry nothing; the chunk rebuilds as
 * objects come and go. Hidden in map and overworld mode.
 */
export class TerrainDetailLayer extends AbstractChunkedDrawLayer {

    /**
     * @param {Biome[]} biomes in biomeId order (ModRegistry.biomes)
     */
    constructor(biomes) {
        super();
        this._biomes = biomes;
        this._hasDetails = biomes.some(biome => biome.details.length > 0);
        /**
         * @type {Terrain|null}
         */
        this._terrain = null;
        this._enabled = true;
        /**
         * Texture name -> texture, resolved on first use (the registry arrives after construction).
         * @type {Map<string, Texture>}
         */
        this._textures = new Map();
        this._pool = new DisplayPool(
            () => new Sprite(),
            sprite => sprite.removeFromParent(),
            () => {},
            POOL_CAPACITY,
        );
    }

    // Over the grid lines, under every placed object.
    get layerIndex() {
        return 1;
    }

    /**
     * Swaps the terrain (a seed arrived, or changed): every chunk rescatters on its next mount.
     * @param {Terrain} terrain
     * @returns {void}
     */
    setTerrain(terrain) {
        this._terrain = terrain;
        this.repaint();
    }

    /**
     * Drops every scattered chunk so the next tick rescatters it: a new terrain, or a biome retune.
     * @returns {void}
     */
    repaint() {
        for (const chunk of [...this._chunks.keys()]) {
            this._unmountChunk(chunk);
            this._dropChunk(chunk);
        }
        // Forces the next tick's reconcile to remount what is on screen.
        this._visibleChunks = new Set();
    }

    /**
     * Shows or hides the details; while off every scattered sprite returns to the pool.
     * @param {boolean} enabled
     * @returns {void}
     */
    setEnabled(enabled) {
        if (this._enabled === enabled) {
            return;
        }
        this._enabled = enabled;
        for (const chunk of [...this._chunks.keys()]) {
            this._unmountChunk(chunk);
            this._dropChunk(chunk);
        }
        // Forces the next tick's reconcile to remount what is on screen.
        this._visibleChunks = new Set();
    }

    /**
     * Map mode hides the details outright; no pooled geometry swap.
     * @param {boolean} value
     */
    set mapMode(value) {
        this._mapMode = value;
        this.visible = !value;
    }

    /**
     * Mounts and drops chunks with the viewport and rescatters chunks whose objects changed; nothing
     * to do while off or hidden, before the seed, or without any declared details.
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks the chunks the viewport covers this frame
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        if (!this._enabled || this._mapMode || this._terrain === null || !this._hasDetails) {
            return;
        }
        this._reconcileViewport(visibleChunks);
        this._flushDirtyChunks();
    }

    /**
     * An object came or went: its chunks rescatter so details under it drop out (or return).
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheChange(entry) {
        for (const cell of entry.cells) {
            const chunk = chunkId(cell.x, cell.y);
            if (this._chunks.has(chunk)) {
                this._dirtyChunks.add(chunk);
            }
        }
    }

    /**
     * Every chunk has ground, so a mount creates the node rather than waiting for a member.
     * @param {number} chunk
     * @returns {void}
     */
    _mountChunk(chunk) {
        this._node(chunk);
        super._mountChunk(chunk);
    }

    /**
     * @param {ChunkNode} node
     * @param {number} chunk
     * @returns {void}
     */
    _initChunkNode(node, chunk) {
        this._scatter(node, chunk);
        node.showSprites();
    }

    /**
     * @param {number} chunk
     * @returns {void}
     */
    _rebuildChunkSprites(chunk) {
        this._dirtyChunks.delete(chunk);
        const node = this._chunks.get(chunk);
        this._releaseSprites(node);
        this._scatter(node, chunk);
    }

    /**
     * A chunk leaving the viewport returns its sprites to the pool and drops.
     * @param {number} chunk
     * @returns {void}
     */
    _unmountChunk(chunk) {
        const wasMounted = this._mounted.has(chunk);
        super._unmountChunk(chunk);
        if (wasMounted) {
            this._releaseSprites(this._chunks.get(chunk));
            this._dropChunk(chunk);
        }
    }

    /**
     * @private
     * @param {ChunkNode} node
     * @returns {void}
     */
    _releaseSprites(node) {
        for (const sprite of [...node.spriteList]) {
            this._pool.release(sprite);
        }
    }

    /**
     * Places the chunk's details: one pooled sprite per decorated, unoccupied tile.
     * @private
     * @param {ChunkNode} node
     * @param {number} chunk
     * @returns {void}
     */
    _scatter(node, chunk) {
        const bake = this._terrain.bakeChunk(chunk);
        const origin = chunkOrigin(chunk);
        const seed = this._terrain.noise.seed;
        let index = 0;
        for (let localY = 0; localY < CHUNK_SIZE; localY++) {
            for (let localX = 0; localX < CHUNK_SIZE; localX++) {
                const biome = this._biomes[bake.biomes[index]];
                index++;
                const tileX = origin.x + localX;
                const tileY = origin.y + localY;
                const detail = this._terrain.detailFor(biome, tileX, tileY);
                if (detail === null || this.cache.at(tileX, tileY, LAYER_SURFACE) !== null) {
                    continue;
                }
                node.sprites.addChild(this._pose(this._pool.take(), detail, biome, tileX, tileY, seed));
            }
        }
    }

    /**
     * @private
     * @param {Sprite} sprite
     * @param {TerrainDetail} detail
     * @param {Biome} biome
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} seed
     * @returns {Sprite}
     */
    _pose(sprite, detail, biome, tileX, tileY, seed) {
        // A second hash for the pose, independent of the placement roll.
        const hash = tileHash(~seed, tileX, tileY);
        const offsetX = ((hash & COLOR_CHANNEL_MASK) / BYTE_RANGE - 0.5) * JITTER * TILE_SIZE;
        const offsetY = (((hash >>> 8) & COLOR_CHANNEL_MASK) / BYTE_RANGE - 0.5) * JITTER * TILE_SIZE;
        sprite.texture = this._texture(detail.texture);
        sprite.anchor.set(0.5, 0.5);
        sprite.position.set((tileX + 0.5) * TILE_SIZE + offsetX, (tileY + 0.5) * TILE_SIZE + offsetY);
        sprite.rotation = ((hash >>> 16) & 3) * QUARTER_TURN;
        sprite.scale.set(detail.scale, detail.scale);
        if (detail.tinted) {
            sprite.tint = scaleColor(biome.color, TINT_DARKEN);
        } else {
            sprite.tint = 0xffffff;
        }
        return sprite;
    }

    /**
     * @private
     * @param {string} name
     * @returns {Texture}
     */
    _texture(name) {
        let texture = this._textures.get(name);
        if (texture === undefined) {
            texture = this.textureRegistry.get(name);
            this._textures.set(name, texture);
        }
        return texture;
    }

    /**
     * Never called: map mode hides the layer instead of swapping to geometry.
     * @param {number} chunk
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunk, graphics) {}
}
