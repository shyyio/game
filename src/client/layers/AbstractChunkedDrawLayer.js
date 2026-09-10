import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {ChunkNode} from "@/client/layers/ChunkNode.js";
import {isSameChunkSet} from "@/client/constants.js";
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
     * Swaps presentation on every view-mode change: setViewMode restores base visibility even when
     * the map flag itself is unchanged (overworld to map), so the hook must always re-apply.
     * @param {boolean} value
     */
    set mapMode(value) {
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
        // A settled viewport hands back the same instance every frame.
        if (visible === this._visibleChunks) {
            return;
        }
        if (isSameChunkSet(visible, this._visibleChunks)) {
            // Adopted so later frames take the identity path.
            this._visibleChunks = visible;
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
     * @param {number} chunkKey
     * @returns {ChunkNode}
     */
    _node(chunkKey) {
        return getOrCreate(this._chunks, chunkKey, () => {
            const node = new ChunkNode();
            this._initChunkNode(node, chunkKey);
            return node;
        });
    }

    /**
     * Optional hook: outfits a freshly created chunk node (e.g. hangs the chunk's mesh).
     * @param {ChunkNode} node
     * @param {number} chunkKey
     * @returns {void}
     */
    _initChunkNode(node, chunkKey) {}

    /**
     * Marks a chunk stale after a member joined it, creating its node and mounting it when on
     * screen. Call after indexing the member, so a mount sees it.
     * @param {number} chunkKey
     * @returns {void}
     */
    _memberAdded(chunkKey) {
        this._node(chunkKey);
        this._dirtyChunks.add(chunkKey);
        if (this._visibleChunks.has(chunkKey)) {
            this._mountChunk(chunkKey);
        }
    }

    /**
     * Marks a chunk stale after a member left it, dropping it once empty.
     * @param {number} chunkKey
     * @param {boolean} empty
     * @returns {void}
     */
    _memberRemoved(chunkKey, empty) {
        if (empty) {
            this._removeChunk(chunkKey);
            return;
        }
        this._dirtyChunks.add(chunkKey);
    }

    /**
     * @param {number} chunkKey
     * @returns {void}
     */
    _mountChunk(chunkKey) {
        const node = this._chunks.get(chunkKey);
        if (node === undefined || this._mounted.has(chunkKey)) {
            return;
        }
        this._mounted.add(chunkKey);
        this._onChunkMounted(chunkKey);
        this.addChild(node.root);
    }

    /**
     * Optional hook: readies a chunk's content as it mounts; by default applies the current mode.
     * @param {number} chunkKey
     * @returns {void}
     */
    _onChunkMounted(chunkKey) {
        this._applyMode(chunkKey);
    }

    /**
     * @param {number} chunkKey
     * @returns {void}
     */
    _unmountChunk(chunkKey) {
        if (!this._mounted.has(chunkKey)) {
            return;
        }
        this.removeChild(this._chunks.get(chunkKey).root);
        this._mounted.delete(chunkKey);
    }

    /**
     * Drops a chunk's node and mount (e.g. with its last child); a no-op for an unknown chunk.
     * @param {number} chunkKey
     * @returns {void}
     */
    _removeChunk(chunkKey) {
        const node = this._chunks.get(chunkKey);
        if (node === undefined) {
            return;
        }
        this._unmountChunk(chunkKey);
        node.destroy();
        this._chunks.delete(chunkKey);
        this._dirtyChunks.delete(chunkKey);
        this._onChunkDropped(chunkKey);
    }

    /**
     * Optional hook: extra teardown as a chunk's node drops (e.g. its mesh index entry).
     * @param {number} chunkKey
     * @returns {void}
     */
    _onChunkDropped(chunkKey) {}

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
     * @param {number} chunkKey
     * @returns {void}
     */
    _rebuildChunk(chunkKey) {
        if (this._mapMode) {
            this._rebuildChunkGeometry(chunkKey);
            return;
        }
        this._rebuildChunkSprites(chunkKey);
    }

    /**
     * Optional hook: rebuilds one stale chunk's sprite content; by default sprites keep themselves
     * current.
     * @param {number} chunkKey
     * @returns {void}
     */
    _rebuildChunkSprites(chunkKey) {}

    /**
     * Hangs the current mode's content under the chunk root, detaching the other one.
     * @param {number} chunkKey
     * @returns {void}
     */
    _applyMode(chunkKey) {
        const node = this._chunks.get(chunkKey);
        if (this._mapMode) {
            node.showGraphics(this._rebuildChunkGeometry(chunkKey));
            return;
        }
        this._prepareChunkSprites(chunkKey);
        node.showSprites();
    }

    /**
     * Optional hook: readies a chunk's sprites before they show (e.g. rebuilds its mesh).
     * @param {number} chunkKey
     * @returns {void}
     */
    _prepareChunkSprites(chunkKey) {}

    /**
     * Redraws one chunk's pooled map-mode geometry into its cleared Graphics.
     * @param {number} chunkKey
     * @returns {Graphics}
     */
    _rebuildChunkGeometry(chunkKey) {
        this._dirtyChunks.delete(chunkKey);
        const node = this._chunks.get(chunkKey);
        if (node.graphics === null) {
            node.graphics = new Graphics();
        } else {
            node.graphics.clear();
        }
        this._drawChunkGeometry(chunkKey, node.graphics);
        return node.graphics;
    }

    /**
     * Draws one chunk's map-mode geometry into its cleared Graphics.
     * @abstract
     * @param {number} chunkKey
     * @param {Graphics} graphics
     * @returns {void}
     */
    _drawChunkGeometry(chunkKey, graphics) {
        throw new NotImplementedError();
    }
}
