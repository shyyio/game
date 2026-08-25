import {AbstractChunkedDrawLayer} from "@/client/layers/AbstractChunkedDrawLayer.js";
import {
    TerrainSprite, TerrainPalette, blankChunkSprite, blankOverworldSprite,
} from "@/client/layers/TerrainSprite.js";
import {ViewMode} from "@/client/constants.js";
import {OVERWORLD_CELLS_PER_AXIS} from "@/common/Terrain.js";
import {setDitherTerrain} from "@/client/layers/DitherPatterns.js";

// Overworld cells baked per tick (~10 ms of sampling), as whole rows.
const OVERWORLD_SAMPLES_PER_TICK = 32768;
const OVERWORLD_ROWS_PER_TICK = Math.max(1, Math.floor(OVERWORLD_SAMPLES_PER_TICK / OVERWORLD_CELLS_PER_AXIS));

/**
 * Paints the ground off the client's seeded Terrain: one {@link TerrainSprite} per chunk the
 * viewport covers in world and map mode, one region-wide chunk-resolution sprite in overworld mode.
 * Needs no chunk subscription and no wire data; inert until the seed arrives, and flat white while
 * the terrain is off. Chunks drop as they leave the viewport, so only on-screen chunks hold a
 * texture.
 */
export class TerrainDrawLayer extends AbstractChunkedDrawLayer {

    /**
     * @param {Biome[]} biomes in biomeId order (ModRegistry.biomes); none = the layer draws nothing
     */
    constructor(biomes) {
        super();
        this._biomes = biomes;
        this._palette = new TerrainPalette(biomes);
        /**
         * @type {Terrain|null}
         */
        this._terrain = null;
        /**
         * Built on first overworld show, after the seed.
         * @type {TerrainSprite|null}
         */
        this._overworld = null;
        this._overworldShown = false;
        this._enabled = true;
    }

    // The ground: everything else draws over it.
    get layerIndex() {
        return -10;
    }

    /**
     * Swaps the terrain (a seed arrived, or changed): every chunk is rebaked on its next mount.
     * @param {Terrain} terrain
     * @returns {void}
     */
    setTerrain(terrain) {
        this._terrain = terrain;
        setDitherTerrain(terrain);
        this.repaint();
    }

    /**
     * Paints the real terrain, or flat white ground while off; off needs no seed and bakes nothing.
     * @param {boolean} enabled
     * @returns {void}
     */
    setEnabled(enabled) {
        if (this._enabled === enabled) {
            return;
        }
        this._enabled = enabled;
        this.repaint();
    }

    /**
     * Drops every baked sprite so the next tick rebuilds it: a new terrain, or a dither swap.
     * @returns {void}
     */
    repaint() {
        for (const chunk of [...this._chunks.keys()]) {
            this._dropChunk(chunk);
        }
        // Forces the next tick's reconcile to remount what is on screen.
        this._visibleChunks = new Set();
        if (this._overworld !== null) {
            this.removeChild(this._overworld);
            this._overworld.destroy();
            this._overworld = null;
        }
        this._syncOverworld();
    }

    /**
     * The ground looks the same in map mode; no pooled geometry swap.
     * @param {boolean} value
     */
    set mapMode(value) {
        this._mapMode = value;
    }

    /**
     * Overworld swaps the chunk sprites (which the empty visible set unmounts) for the region sprite.
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this.visible = true;
        this._mapMode = mode === ViewMode.MAP;
        this._overworldShown = mode === ViewMode.OVERWORLD;
        this._syncOverworld();
    }

    /**
     * Shows the region sprite when overworld is up and the terrain is known, building it lazily;
     * its rows fill in over the following ticks.
     * @private
     * @returns {void}
     */
    _syncOverworld() {
        if (!this._overworldShown || !this._ready) {
            if (this._overworld !== null) {
                this._overworld.visible = false;
            }
            return;
        }
        if (this._overworld === null) {
            if (this._enabled) {
                this._overworld = TerrainSprite.forOverworld(this._palette, this._terrain.overworldBake);
            } else {
                this._overworld = blankOverworldSprite();
            }
            this.addChild(this._overworld);
        }
        this._overworld.visible = true;
    }

    /**
     * Whether ground can be painted: blank ground needs nothing, the real terrain needs the seed.
     * @private
     * @returns {boolean}
     */
    get _ready() {
        if (!this._enabled) {
            return true;
        }
        return this._terrain !== null && this._biomes.length > 0;
    }

    /**
     * Mounts and drops chunks with the viewport; nothing to do before the seed.
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks the chunks the viewport covers this frame
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        if (!this._ready) {
            return;
        }
        if (this._enabled && this._overworldShown) {
            this._bakeOverworldStep();
        }
        this._reconcileViewport(visibleChunks);
    }

    /**
     * Bakes and uploads the next overworld rows until the region is complete.
     * @private
     * @returns {void}
     */
    _bakeOverworldStep() {
        if (this._terrain.overworldBaked) {
            return;
        }
        const fromRow = this._terrain.bakeOverworldRows(OVERWORLD_ROWS_PER_TICK);
        this._overworld.updateRows(this._terrain.overworldBake, fromRow, OVERWORLD_ROWS_PER_TICK);
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
     * Hangs the chunk's ground sprite under its fresh node.
     * @param {ChunkNode} node
     * @param {number} chunk
     * @returns {void}
     */
    _initChunkNode(node, chunk) {
        if (this._enabled) {
            node.sprites.addChild(TerrainSprite.forChunk(
                this._palette, chunk, this._terrain.bakeChunk(chunk), this._terrain,
            ));
        } else {
            node.sprites.addChild(blankChunkSprite(chunk));
        }
        node.showSprites();
    }

    /**
     * The sprite is ready from creation; nothing mode-dependent to apply.
     * @param {number} chunk
     * @returns {void}
     */
    _onChunkMounted(chunk) {}

    /**
     * A chunk leaving the viewport drops with its texture; a remount rebuilds it from the bake cache.
     * @param {number} chunk
     * @returns {void}
     */
    _unmountChunk(chunk) {
        const wasMounted = this._mounted.has(chunk);
        super._unmountChunk(chunk);
        if (wasMounted) {
            this._dropChunk(chunk);
        }
    }

    /**
     * Never called: the ground never swaps to map geometry.
     * @param {number} chunk
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunk, graphics) {}
}
