import {AbstractChunkedDrawLayer} from "@/client/layers/AbstractChunkedDrawLayer.js";
import {
    TerrainSprite, TerrainPalette, blankChunkSprite, blankOverworldSprite,
} from "@/client/layers/TerrainSprite.js";
import {ViewMode} from "@/client/constants.js";
import {OVERWORLD_CELLS_PER_AXIS} from "@/common/Terrain.js";
import {setDitherTerrain} from "@/client/layers/DitherPatterns.js";
import {TerrainCellTable, TerrainMesh} from "@/client/layers/TerrainMesh.js";

// Overworld cells baked per frame (~2.5 ms of sampling), as whole rows.
const OVERWORLD_SAMPLES_PER_TICK = 8192;
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
        /**
         * Built on first use: the texture cache is assigned after construction.
         * @type {TerrainCellTable|null}
         */
        this._cellTable = null;
        /**
         * chunk -> its ground art, for the chunks whose biomes have any.
         * @type {Map<number, TerrainMesh>}
         */
        this._meshes = new Map();
        /**
         * chunk -> its painted biome colors.
         * @type {Map<number, TerrainSprite>}
         */
        this._colors = new Map();
    }

    /**
     * @private
     * @returns {TerrainCellTable}
     */
    _getCellTable() {
        if (this._cellTable === null) {
            this._cellTable = new TerrainCellTable(this._biomes, this.textureCache);
        }
        return this._cellTable;
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
        this.rebuild();
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
        this.rebuild();
    }

    /**
     * Drops every baked sprite so the next tick rebuilds it: a new terrain, or a dither swap. The
     * palette is rebuilt too, so a retuned biome color or shade step takes effect here.
     * @returns {void}
     */
    rebuild() {
        this._palette = new TerrainPalette(this._biomes);
        for (const chunk of Array.from(this._chunks.keys())) {
            this._removeChunk(chunk);
        }
        // Forces the next tick's reconcile to remount what is on screen.
        this._visibleChunks = new Set();
        if (this._overworld !== null) {
            this.removeChild(this._overworld);
            this._overworld.destroy();
            this._overworld = null;
        }
        this._applyOverworldMode();
    }

    /**
     * Map mode drops to the flat biome colors the palette paints: ground art is authored for one
     * world pixel per texel, and a map-mode tile is a handful of pixels wide.
     * @param {boolean} value
     */
    set isMapMode(value) {
        this._isMapMode = value;
        for (const mesh of this._meshes.values()) {
            mesh.visible = !value;
        }
        for (const sprite of this._colors.values()) {
            sprite.visible = this._isColorShown;
        }
    }

    /**
     * The colors are the ground itself until every biome has art; after that they are what map mode
     * drops to, and world mode would only draw them under opaque tiles.
     * @private
     * @returns {boolean}
     */
    get _isColorShown() {
        if (this._isMapMode) {
            return true;
        }
        return !this._getCellTable().coversEveryBiome;
    }

    /**
     * Overworld swaps the chunk sprites (which the empty visible set unmounts) for the region sprite.
     * @param {ViewMode} mode
     * @returns {void}
     */
    setViewMode(mode) {
        this.visible = true;
        // Through the setter, so chunks mounted in another mode take the new one.
        this.isMapMode = mode !== ViewMode.WORLD;
        this._overworldShown = mode === ViewMode.OVERWORLD;
        this._applyOverworldMode();
    }

    /**
     * Shows the region sprite when overworld is up and the terrain is known, building it lazily;
     * its rows fill in over the following ticks.
     * @private
     * @returns {void}
     */
    _applyOverworldMode() {
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
        this._overworld.drawRows(this._terrain.overworldBake, fromRow, OVERWORLD_ROWS_PER_TICK);
    }

    /**
     * Every chunk has ground, so a mount creates the node.
     * @param {number} chunkKey
     * @returns {void}
     */
    _mountChunk(chunkKey) {
        this._node(chunkKey);
        super._mountChunk(chunkKey);
    }

    /**
     * Hangs the chunk's ground sprite under its fresh node.
     * @param {ChunkNode} node
     * @param {number} chunkKey
     * @returns {void}
     */
    _initChunkNode(node, chunkKey) {
        if (this._enabled) {
            const bake = this._terrain.bakeChunk(chunkKey);
            this._addColors(node, chunkKey, bake);
            this._addMesh(node, chunkKey, bake);
        } else {
            node.sprites.addChild(blankChunkSprite(chunkKey));
        }
        node.showSprites();
    }

    /**
     * Hangs the chunk's painted biome colors under its ground art.
     * @private
     * @param {ChunkNode} node
     * @param {number} chunkKey
     * @param {BiomeGrid} bake
     * @returns {void}
     */
    _addColors(node, chunkKey, bake) {
        const sprite = TerrainSprite.forChunk(this._palette, chunkKey, bake, this._terrain);
        sprite.visible = this._isColorShown;
        node.sprites.addChild(sprite);
        this._colors.set(chunkKey, sprite);
    }

    /**
     * Hangs the chunk's ground art over its painted colors, for the biomes that have art; the
     * colors stay visible under the tiles of those that do not.
     * @private
     * @param {ChunkNode} node
     * @param {number} chunkKey
     * @param {BiomeGrid} bake
     * @returns {void}
     */
    _addMesh(node, chunkKey, bake) {
        const cells = this._getCellTable();
        if (!cells.hasArt) {
            return;
        }
        const mesh = new TerrainMesh(cells, chunkKey, bake);
        mesh.visible = !this._isMapMode;
        node.sprites.addChild(mesh);
        this._meshes.set(chunkKey, mesh);
    }

    /**
     * The chunk's ground goes with its node.
     * @param {number} chunkKey
     * @returns {void}
     */
    _onChunkDropped(chunkKey) {
        this._meshes.delete(chunkKey);
        this._colors.delete(chunkKey);
    }

    /**
     * The sprite is ready from creation; nothing mode-dependent to apply.
     * @param {number} chunkKey
     * @returns {void}
     */
    _onChunkMounted(chunkKey) {}

    /**
     * A chunk leaving the viewport drops with its texture; a remount rebuilds it from the bake cache.
     * @param {number} chunkKey
     * @returns {void}
     */
    _unmountChunk(chunkKey) {
        const wasMounted = this._mounted.has(chunkKey);
        super._unmountChunk(chunkKey);
        if (wasMounted) {
            this._removeChunk(chunkKey);
        }
    }

    /**
     * Never called: the ground never swaps to map geometry.
     * @param {number} chunkKey
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunkKey, graphics) {}
}
