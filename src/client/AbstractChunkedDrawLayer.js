import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {ChunkNode} from "@/client/ChunkNode.js";
import {sameChunks} from "@/client/constants.js";
import {NotImplementedError} from "@/common/error.js";
import {getOrCreate} from "@/common/util.js";

/**
 * A layer whose children group per chunk under {@link ChunkNode} roots: chunk roots mount and
 * unmount as the viewport moves, stale chunks rebuild in one pass per tick, and map mode swaps
 * each mounted chunk's sprites for pooled geometry.
 * @abstract
 */
export class AbstractChunkedDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        /**
         * chunk -> its node, created on first use.
         * @type {Map<number, ChunkNode>}
         */
        this._chunks = new Map();
        // The chunks whose roots are mounted, and those whose content a change left stale.
        this._mounted = new Set();
        this._dirtyChunks = new Set();
        this._visibleChunks = new Set();
        this._mapMode = false;
    }

    /**
     * Swaps presentation on map-mode change.
     * @param {boolean} value
     */
    set mapMode(value) {
        if (value === this._mapMode) {
            return;
        }
        this._mapMode = value;
        this._applyMapMode();
    }

    /**
     * Optional hook: applies a map-mode change; by default re-applies every mounted chunk's mode.
     * @returns {void}
     */
    _applyMapMode() {
        for (const chunk of this._mounted) {
            this._applyMode(chunk);
        }
    }

    /**
     * Reconciles mounted chunks against the viewport, flushes stale chunks, and runs the
     * sprite-mode hook.
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks the chunks the viewport covers this frame
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        this._reconcileViewport(visibleChunks);
        if (this._mapMode) {
            this._tickMapMode();
            return;
        }
        this._updateSprites(frame, deltaMS);
        this._flushDirtyChunks();
    }

    /**
     * Optional hook: the map-mode tick; by default flushes stale map geometry.
     * @returns {void}
     */
    _tickMapMode() {
        this._flushDirtyChunks();
    }

    /**
     * Optional hook: sprite-mode per-tick work, before stale chunks flush (advance sprites, stage
     * rebuilds).
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @returns {void}
     */
    _updateSprites(frame, deltaMS) {}

    /**
     * Mounts the chunks that panned into view and unmounts those that panned out.
     * @param {Set<number>} visible the chunks the viewport covers this frame
     * @returns {void}
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
     * The chunk's node, created empty on first use.
     * @param {number} chunk
     * @returns {ChunkNode}
     */
    _node(chunk) {
        return getOrCreate(this._chunks, chunk, () => {
            const node = new ChunkNode();
            this._initChunkNode(node, chunk);
            return node;
        });
    }

    /**
     * Optional hook: outfits a freshly created chunk node (e.g. hangs the chunk's mesh).
     * @param {ChunkNode} node
     * @param {number} chunk
     * @returns {void}
     */
    _initChunkNode(node, chunk) {}

    /**
     * Marks a chunk stale after a member joined it, creating its node and mounting it when on
     * screen. Call after indexing the member, so a mount sees it.
     * @param {number} chunk
     * @returns {void}
     */
    _memberAdded(chunk) {
        this._node(chunk);
        this._dirtyChunks.add(chunk);
        if (this._visibleChunks.has(chunk)) {
            this._mountChunk(chunk);
        }
    }

    /**
     * Marks a chunk stale after a member left it, dropping it once empty.
     * @param {number} chunk
     * @param {boolean} empty
     * @returns {void}
     */
    _memberRemoved(chunk, empty) {
        if (empty) {
            this._dropChunk(chunk);
            return;
        }
        this._dirtyChunks.add(chunk);
    }

    /**
     * @param {number} chunk
     * @returns {void}
     */
    _mountChunk(chunk) {
        const node = this._chunks.get(chunk);
        if (node === undefined || this._mounted.has(chunk)) {
            return;
        }
        this._mounted.add(chunk);
        this._onChunkMounted(chunk);
        this.addChild(node.root);
    }

    /**
     * Optional hook: readies a chunk's content as it mounts; by default applies the current mode.
     * @param {number} chunk
     * @returns {void}
     */
    _onChunkMounted(chunk) {
        this._applyMode(chunk);
    }

    /**
     * @param {number} chunk
     * @returns {void}
     */
    _unmountChunk(chunk) {
        if (!this._mounted.has(chunk)) {
            return;
        }
        this.removeChild(this._chunks.get(chunk).root);
        this._mounted.delete(chunk);
    }

    /**
     * Drops a chunk's node and mount (e.g. with its last child); a no-op for an unknown chunk.
     * @param {number} chunk
     * @returns {void}
     */
    _dropChunk(chunk) {
        const node = this._chunks.get(chunk);
        if (node === undefined) {
            return;
        }
        this._unmountChunk(chunk);
        node.destroy();
        this._chunks.delete(chunk);
        this._dirtyChunks.delete(chunk);
        this._onChunkDropped(chunk);
    }

    /**
     * Optional hook: extra teardown as a chunk's node drops (e.g. its mesh index entry).
     * @param {number} chunk
     * @returns {void}
     */
    _onChunkDropped(chunk) {}

    /**
     * Rebuilds every stale mounted chunk in one pass.
     * @returns {void}
     */
    _flushDirtyChunks() {
        if (this._dirtyChunks.size === 0) {
            return;
        }
        for (const chunk of this._dirtyChunks) {
            if (this._mounted.has(chunk)) {
                this._rebuildChunk(chunk);
            }
        }
        this._dirtyChunks.clear();
    }

    /**
     * Rebuilds one stale chunk in the current mode.
     * @param {number} chunk
     * @returns {void}
     */
    _rebuildChunk(chunk) {
        if (this._mapMode) {
            this._rebuildChunkGeometry(chunk);
            return;
        }
        this._rebuildChunkSprites(chunk);
    }

    /**
     * Optional hook: rebuilds one stale chunk's sprite content; by default sprites keep themselves
     * current.
     * @param {number} chunk
     * @returns {void}
     */
    _rebuildChunkSprites(chunk) {}

    /**
     * Hangs the current mode's content under the chunk root, detaching the other one.
     * @param {number} chunk
     * @returns {void}
     */
    _applyMode(chunk) {
        const node = this._chunks.get(chunk);
        if (this._mapMode) {
            node.showGraphics(this._rebuildChunkGeometry(chunk));
            return;
        }
        this._prepareChunkSprites(chunk);
        node.showSprites();
    }

    /**
     * Optional hook: readies a chunk's sprites before they show (e.g. rebuilds its mesh).
     * @param {number} chunk
     * @returns {void}
     */
    _prepareChunkSprites(chunk) {}

    /**
     * Redraws one chunk's pooled map-mode geometry into its cleared Graphics.
     * @param {number} chunk
     * @returns {Graphics}
     */
    _rebuildChunkGeometry(chunk) {
        this._dirtyChunks.delete(chunk);
        const node = this._chunks.get(chunk);
        if (node.graphics === null) {
            node.graphics = new Graphics();
        } else {
            node.graphics.clear();
        }
        this._drawChunkGeometry(chunk, node.graphics);
        return node.graphics;
    }

    /**
     * Draws one chunk's map-mode geometry into its cleared Graphics.
     * @abstract
     * @param {number} chunk
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunk, graphics) {
        throw new NotImplementedError();
    }
}
