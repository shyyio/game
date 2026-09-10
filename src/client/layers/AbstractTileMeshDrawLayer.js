import {AbstractChunkedDrawLayer} from "@/client/layers/AbstractChunkedDrawLayer.js";
import {AnimatedTileMesh, AnimatedTileShader, FrameTable} from "@/client/layers/AnimatedTileMesh.js";
import {NotImplementedError} from "@/common/error.js";

/**
 * A chunked layer whose sprite mode draws each chunk as one {@link AnimatedTileMesh}: every chunk
 * shares the layer's frame table and shader, so the animation advances with a single uniform write
 * per frame.
 * @abstract
 */
export class AbstractTileMeshDrawLayer extends AbstractChunkedDrawLayer {

    constructor() {
        super();
        /**
         * chunk -> its mesh, hung under the chunk node at creation.
         * @type {Map<number, AnimatedTileMesh>}
         */
        this._meshes = new Map();
        // Built on first use, once the texture registry is injected.
        this._frameTable = null;
        this._shader = null;
    }

    /**
     * The sequence names the shared frame table loads, in slot order.
     * @abstract
     * @returns {string[]}
     */
    get meshSequences() {
        throw new NotImplementedError();
    }

    /**
     * The tiles a chunk's mesh draws.
     * @abstract
     * @param {number} chunkKey
     * @returns {AnimatedTile[]}
     */
    _buildTiles(chunkKey) {
        throw new NotImplementedError();
    }

    /**
     * The shader every chunk mesh draws with, built on first use.
     * @returns {AnimatedTileShader}
     */
    _meshShader() {
        if (this._shader === null) {
            if (this.textureCache === null) {
                throw new Error(`${this.constructor.name} needs a texture registry before it draws`);
            }
            this._frameTable = new FrameTable(this.textureCache, this.meshSequences);
            this._shader = new AnimatedTileShader(this._frameTable);
        }
        return this._shader;
    }

    /**
     * The frame-table slot of a sequence name.
     * @param {string} name
     * @returns {number}
     */
    _getSlotByName(name) {
        this._meshShader();
        return this._frameTable.getSlotByName(name);
    }

    /**
     * Hangs the chunk's animated mesh under its fresh node.
     * @param {ChunkNode} node
     * @param {number} chunkKey
     * @returns {void}
     */
    _initChunkNode(node, chunkKey) {
        const mesh = new AnimatedTileMesh(this._meshShader());
        node.sprites.addChild(mesh);
        node.showSprites();
        this._meshes.set(chunkKey, mesh);
    }

    /**
     * @param {number} chunkKey
     * @returns {void}
     */
    _rebuildChunkSprites(chunkKey) {
        this._dirtyChunks.delete(chunkKey);
        this._meshes.get(chunkKey).setTiles(this._buildTiles(chunkKey));
    }

    /**
     * @param {number} chunkKey
     * @returns {void}
     */
    _prepareChunkSprites(chunkKey) {
        this._rebuildChunkSprites(chunkKey);
    }

    /**
     * @param {number} chunkKey
     * @returns {void}
     */
    _onChunkDropped(chunkKey) {
        this._meshes.delete(chunkKey);
    }

    /**
     * Advances every on-screen mesh: the meshes hold the animation frame as a uniform, so one
     * write covers them all.
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @returns {void}
     */
    _updateSprites(frame, deltaMS) {
        if (this._shader !== null) {
            this._shader.frame = frame;
        }
    }
}
