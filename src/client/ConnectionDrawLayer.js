import {Sprite, Texture} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {ChunkNode} from "@/client/ChunkNode.js";
import {TILE_SIZE, sameChunks} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";

// Output (front) and input (back) connection stubs, rotated by the object's facing.
const OUTPUT_CONNECTION = "machine-connection-top-up";
const INPUT_CONNECTION = "machine-connection-bottom-up";

// An animated half-belt stub bridging a port to whatever it connects to.
class ConnectionSprite extends Sprite {

    /**
     * @param {number} x - tile the stub draws on
     * @param {number} y
     * @param {number} angle - sprite rotation in degrees
     * @param {Texture[]|undefined} frames - ordered animation frames
     */
    constructor(x, y, angle, frames) {
        super(Texture.EMPTY);
        this.anchor = 0.5;
        this.angle = angle;
        this.frames = frames;
        this.position.set(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
    }

    /**
     * Shows the given frame, wrapping modulo the sequence length.
     * @param {number} frame animation frame, in [0, 8)
     */
    setAnimationFrame(frame) {
        if (this.frames === undefined || this.frames.length === 0) {
            this.texture = Texture.EMPTY;
            return;
        }
        this.texture = this.frames[frame % this.frames.length];
    }
}

/**
 * The single shared connection layer: draws an animated stub at each connected port of every cached
 * object whose definition opts in (`renderConnections`). Connection geometry is re-derived only for
 * the objects a cache change touched, and only on-screen chunks are mounted.
 */
export class ConnectionDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        // Connection geometry per object id, re-derived only when the object or a neighbor changes.
        this._connections = new Map();
        // Live sprites per object id, and the chunk node each object's sprites hang under.
        this._sprites = new Map();
        this._spriteChunks = new Map();
        this._chunks = new Map();
        // Object ids whose connections need re-deriving on the next tick.
        this._dirty = new Set();
        // The chunks whose roots are mounted.
        this._mounted = new Set();
        this._visibleChunks = new Set();
        this._mapMode = false;
    }

    get layerIndex() {
        // Above belts (10) but below belt items (15), so items ride over the connection stubs.
        return 14;
    }

    /**
     * Subscribes to the shared cache; the client calls this once when it builds the layer.
     * @param {ClientCache} cache
     * @returns {void}
     */
    bindCache(cache) {
        // Set here too: the listeners fire before Client.init injects the layer's cache.
        this.cache = cache;
        cache.onSet(entry => this._markDirty(entry));
        cache.onRemove(entry => this._markDirty(entry));
    }

    /**
     * No-op: a pure renderer, driven by cache listeners.
     * @param {AbstractEvent} event
     */
    onEvent(event) {}

    /**
     * Hidden in map mode (the stubs are sprite-only detail).
     * @param {boolean} value
     */
    set mapMode(value) {
        this._mapMode = value;
        this.visible = !value;
    }

    /**
     * Re-derives the connections a cache change invalidated, reconciles sprites against the
     * visible chunks, then advances every live stub to the shared animation frame.
     * @param {number} frame animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks the chunks the viewport covers this frame
     */
    tick(frame, deltaMS, visibleChunks) {
        if (this._mapMode || this.cache === null || this.textureRegistry === null) {
            return;
        }
        this._reconcileViewport(visibleChunks);
        this._flushDirty();
        for (const chunk of this._mounted) {
            for (const sprite of this._chunks.get(chunk).spriteList) {
                sprite.setAnimationFrame(frame);
            }
        }
    }

    /**
     * Queues an object and its connected neighbors for re-derivation: the change may have made or
     * broken a connection on either side of the port pair.
     * @param {CacheEntry} entry
     * @returns {void}
     * @private
     */
    _markDirty(entry) {
        if (!entry.data.type.renderConnections) {
            return;
        }
        this._dirty.add(entry.id);
        for (const connection of this.cache.connectedPorts(entry)) {
            this._dirty.add(connection.neighbor.id);
        }
    }

    /**
     * Re-derives every queued object's connections and resyncs its sprites.
     * @returns {void}
     * @private
     */
    _flushDirty() {
        if (this._dirty.size === 0) {
            return;
        }
        for (const id of this._dirty) {
            const entry = this.cache.get(id);
            if (entry === null) {
                this._connections.delete(id);
            } else {
                this._connections.set(id, this._deriveConnections(entry));
            }
            this._syncSprites(id);
        }
        this._dirty.clear();
    }

    /**
     * The stubs `entry` should show: one per connected port, on the port's own side of the pair.
     * @param {CacheEntry} entry
     * @returns {{base: string, tileX: number, tileY: number, angle: number}[]}
     * @private
     */
    _deriveConnections(entry) {
        const angle = Direction.angle(entry.data.direction);
        const connections = [];

        for (const connection of this.cache.connectedPorts(entry)) {
            connections.push({
                base: connection.isOutput ? OUTPUT_CONNECTION : INPUT_CONNECTION,
                tileX: connection.tileX,
                tileY: connection.tileY,
                angle,
            });
        }
        return connections;
    }

    /**
     * Rebuilds one object's sprites from its derived connections, dropping them when the object is
     * gone or off-screen.
     * @param {number} id
     * @returns {void}
     * @private
     */
    _syncSprites(id) {
        this._dropSprites(id);

        const entry = this.cache.get(id);
        if (entry === null) {
            return;
        }

        const connections = this._connections.get(id);
        if (connections === undefined || connections.length === 0) {
            return;
        }

        const node = this._node(entry.chunk);
        const sprites = [];
        for (const connection of connections) {
            const sprite = new ConnectionSprite(
                connection.tileX,
                connection.tileY,
                connection.angle,
                this.textureRegistry.getAnimation(connection.base),
            );
            node.sprites.addChild(sprite);
            sprites.push(sprite);
        }
        this._sprites.set(id, sprites);
        this._spriteChunks.set(id, entry.chunk);

        if (this._visibleChunks.has(entry.chunk)) {
            this._mountChunk(entry.chunk);
        }
    }

    /**
     * Destroys one object's stubs, dropping its chunk node once nothing is left in it.
     * @param {number} id
     * @returns {void}
     * @private
     */
    _dropSprites(id) {
        const existing = this._sprites.get(id);
        if (existing === undefined) {
            return;
        }
        for (const sprite of existing) {
            // Scans only its own chunk's children, and detaches from its parent.
            sprite.destroy();
        }
        this._sprites.delete(id);

        const chunk = this._spriteChunks.get(id);
        this._spriteChunks.delete(id);

        const node = this._chunks.get(chunk);
        if (node !== undefined && node.isEmpty) {
            this._unmountChunk(chunk);
            node.destroy();
            this._chunks.delete(chunk);
        }
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
            node.showSprites();
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
        this.addChild(node.root);
        this._mounted.add(chunk);
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
}
