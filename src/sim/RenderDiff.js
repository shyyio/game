import {chunkId} from "@/common/util.js";
import {PortItemBatchEvent} from "@/common/PortItemEvents.js";
import {EMPTY} from "@/sim/sentinels.js";

// How a port lost its item this tick, so the diff re-emits a refilled port (the client animates the
// swap) and flags engine-drained clears consumed (the item glides into the consumer).
const PORT_EMPTIED_NONE = 0;
const PORT_EMPTIED_MOD = 1;
const PORT_EMPTIED_CONSUMED = 2;

/**
 * What the client is told about resting port items. Modules register the out-ports whose item is
 * drawn and the tile it is drawn at; EMIT_RENDER diffs each port written since the last pass against
 * the shadow of what was last emitted, and sends one batch per chunk.
 */
export class RenderDiff {

    /**
     * @param {GameEngine} engine
     * @param {number} portCapacity - the Port component's current column length
     */
    constructor(engine, portCapacity) {
        this.engine = engine;

        // Last emitted item per rendered port; EMPTY means nothing drawn.
        this._shadow = new Int32Array(portCapacity).fill(EMPTY);
        // Out-ports whose resting item is drawn, and the tile it is drawn at. Modules register theirs;
        // re-registration is idempotent and a removed path's port can be unregistered (paths churn).
        this._rendered = new Uint8Array(portCapacity);
        this._x = new Int32Array(portCapacity);
        this._y = new Int32Array(portCapacity);
        // chunk -> Set of rendered port eids, so chunk sync walks only the chunk's ports.
        this._byChunk = new Map();
        // Ports written since the last diff, and a per-eid flag so a port enters the list once. The
        // diff walks this rather than every rendered port in the world.
        this._dirty = [];
        this._isDirty = new Uint8Array(portCapacity);
        // How each port lost its item this tick (PORT_EMPTIED_*).
        this._emptied = new Uint8Array(portCapacity);
        // Whether a rendered port's tile has a watcher, and the observation generation that answer was
        // computed at (0 = never). The diff would otherwise hash the chunk and call through the
        // subscription predicate for every port written this tick.
        this._observed = new Uint8Array(portCapacity);
        this._observedGen = new Int32Array(portCapacity);
        // Ports unregistered while holding a rendered item (eid -> {x, y}): a pending clear, cancelled
        // if the port is re-registered in the same edit (so a churned-but-surviving port stays static,
        // no clear+set glide). Flushed by the diff.
        this._pendingClear = new Map();
    }

    /**
     * Grows the per-port columns with the Port component.
     * @param {number} capacity
     * @returns {void}
     */
    growPortColumns(capacity) {
        for (const name of ["_x", "_y", "_observedGen"]) {
            const grown = new Int32Array(capacity);
            grown.set(this[name]);
            this[name] = grown;
        }
        const shadow = new Int32Array(capacity).fill(EMPTY);
        shadow.set(this._shadow);
        this._shadow = shadow;
        for (const name of ["_isDirty", "_emptied", "_rendered", "_observed"]) {
            const grown = new Uint8Array(capacity);
            grown.set(this[name]);
            this[name] = grown;
        }
    }

    /**
     * Registers an out-port whose resting item is drawn at tile (x, y); EMIT_RENDER emits a set/clear
     * event whenever its item changes.
     * @param {number} eid
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    registerPort(eid, x, y) {
        if (this._rendered[eid] === 1) {
            // Re-registered at a possibly different tile: drop the old chunk-index slot first.
            this._unindex(eid);
        }
        this._rendered[eid] = 1;
        this._observedGen[eid] = 0;
        this._x[eid] = x;
        this._y[eid] = y;
        this._index(eid);
        // A re-registered port survives the edit: cancel any pending clear so its sprite stays put
        // (item unchanged -> the diff emits nothing) instead of a clear+set that glides in a new sprite.
        this._pendingClear.delete(eid);
        this.markDirty(eid);
    }

    /**
     * Stops drawing a port (its path was removed). If it held a rendered item, the clear is deferred to
     * the next diff so a same-edit re-registration can cancel it (keeping a surviving port static).
     * @param {number} eid
     * @returns {void}
     */
    unregisterPort(eid) {
        if (this._rendered[eid] === 1) {
            if (this._shadow[eid] !== EMPTY) {
                this._pendingClear.set(eid, {x: this._x[eid], y: this._y[eid]});
            }
            this._unindex(eid);
        }
        this._rendered[eid] = 0;
    }

    /**
     * The tile a rendered port's resting item is drawn at, or null if the port is not rendered.
     * @param {number} eid
     * @returns {{x:number, y:number}|null}
     */
    portTile(eid) {
        if (this._rendered[eid] === 0) {
            return null;
        }
        return {x: this._x[eid], y: this._y[eid]};
    }

    /**
     * Queues a port for the next diff. The diff walks only these, so every write to Port.item must
     * come through here (see GameEngine#setPortItem).
     * @param {number} eid
     * @returns {void}
     */
    markDirty(eid) {
        if (this._isDirty[eid] === 1) {
            return;
        }
        this._isDirty[eid] = 1;
        this._dirty.push(eid);
    }

    /**
     * Notes that a mod emptied a port, so the diff clears the drawn item even if something refills it
     * the same tick. The first cause of the tick wins.
     * @param {number} eid
     * @returns {void}
     */
    noteCleared(eid) {
        if (this._emptied[eid] === PORT_EMPTIED_NONE) {
            this._emptied[eid] = PORT_EMPTIED_MOD;
        }
    }

    /**
     * Notes that a consumer ate a port's item, so its clear renders as a glide into the consumer.
     * @param {number} eid
     * @returns {void}
     */
    noteConsumed(eid) {
        this._emptied[eid] = PORT_EMPTIED_CONSUMED;
    }

    /**
     * Clears a recycled port eid's leftover shadow, so a previous tenant never leaks into it.
     * @param {number} eid
     * @returns {void}
     */
    forgetPort(eid) {
        this._shadow[eid] = EMPTY;
    }

    /**
     * Retires ports the sweep is about to destroy: a port that dies holding a drawn item emits its
     * deferred clear now, since no later diff will.
     * @param {Iterable<number>} eids
     * @returns {void}
     */
    retirePorts(eids) {
        const batches = new Map();
        for (const eid of eids) {
            const pending = this._pendingClear.get(eid);
            if (pending !== undefined) {
                this._batchAt(batches, pending.x, pending.y).addClear(eid);
                this._pendingClear.delete(eid);
            }
            if (this._rendered[eid] === 1) {
                this._unindex(eid);
            }
            this._rendered[eid] = 0;
            this._shadow[eid] = EMPTY;
        }
        for (const batch of batches.values()) {
            this.engine.emitEvent(batch);
        }
    }

    /**
     * Drops every port's render state, for a world being replaced by a load.
     * @returns {void}
     */
    reset() {
        this._rendered.fill(0);
        this._byChunk = new Map();
        this._shadow.fill(EMPTY);
        this._isDirty.fill(0);
        this._emptied.fill(PORT_EMPTIED_NONE);
        this._dirty.length = 0;
        this._pendingClear = new Map();
    }

    /**
     * EMIT_RENDER: flush deferred clears (ports unregistered for good), then diff each port written
     * since the last pass against the shadow, buffering a set (item appeared or changed) or clear
     * (item left) event.
     * @returns {void}
     */
    emit() {
        // One batch per chunk, flushed at the end of the pass so the pass stays ordered against
        // everything emitted outside it.
        const batches = new Map();

        for (const [eid, position] of this._pendingClear) {
            this._batchAt(batches, position.x, position.y).addClear(eid);
            this._shadow[eid] = EMPTY;
        }
        this._pendingClear.clear();

        const item = this.engine.Port.item;
        for (const eid of this._dirty) {
            this._isDirty[eid] = 0;
            const emptied = this._emptied[eid];
            this._emptied[eid] = PORT_EMPTIED_NONE;
            if (this._rendered[eid] === 0) {
                continue;
            }
            // A fluid payload draws no item sprite, so it diffs as an empty port.
            let displayed = item[eid];
            if (this.engine.isFluid(displayed)) {
                displayed = EMPTY;
            }
            // An emptied port's shown item is cleared even when a new one refills it the same tick
            // (a silent same-type swap would leave the client's sprite standing still).
            const emptiedShown = emptied !== PORT_EMPTIED_NONE && this._shadow[eid] !== EMPTY;
            if (displayed === this._shadow[eid] && !emptiedShown) {
                continue;
            }
            this._shadow[eid] = displayed;
            if (!this._observedAt(eid)) {
                continue;
            }
            const batch = this._batchAt(batches, this._x[eid], this._y[eid]);
            if (emptiedShown || displayed === EMPTY) {
                const consumed = emptied === PORT_EMPTIED_CONSUMED ? 1 : 0;
                batch.addClear(eid, consumed);
            }
            if (displayed !== EMPTY) {
                batch.addSet(eid, displayed);
            }
        }
        this._dirty.length = 0;

        for (const batch of batches.values()) {
            this.engine.emitEvent(batch);
        }
    }

    /**
     * The chunk's resting rendered-port items as one set-only batch, or null when it has none.
     * @param {number} chunk
     * @returns {PortItemBatchEvent|null}
     */
    chunkSync(chunk) {
        const eids = this._byChunk.get(chunk);
        if (eids === undefined) {
            return null;
        }
        const item = this.engine.Port.item;
        let batch = null;
        for (const eid of eids) {
            if (item[eid] === EMPTY || this.engine.isFluid(item[eid])) {
                continue;
            }
            if (batch === null) {
                batch = new PortItemBatchEvent(this._x[eid], this._y[eid]);
            }
            batch.addSet(eid, item[eid]);
        }
        return batch;
    }

    /**
     * Adds a rendered port to its tile's chunk index.
     * @private
     * @param {number} eid
     * @returns {void}
     */
    _index(eid) {
        const chunk = chunkId(this._x[eid], this._y[eid]);
        let eids = this._byChunk.get(chunk);
        if (eids === undefined) {
            eids = new Set();
            this._byChunk.set(chunk, eids);
        }
        eids.add(eid);
    }

    /**
     * Removes a rendered port from its tile's chunk index.
     * @private
     * @param {number} eid
     * @returns {void}
     */
    _unindex(eid) {
        const chunk = chunkId(this._x[eid], this._y[eid]);
        const eids = this._byChunk.get(chunk);
        if (eids === undefined) {
            return;
        }
        eids.delete(eid);
        if (eids.size === 0) {
            this._byChunk.delete(chunk);
        }
    }

    /**
     * Whether the port's render tile has a watcher, cached until the observation generation moves.
     * @private
     * @param {number} eid
     * @returns {boolean}
     */
    _observedAt(eid) {
        const generation = this.engine.observerGeneration;
        if (this._observedGen[eid] === generation) {
            return this._observed[eid] === 1;
        }
        const observed = this.engine.observesTile(this._x[eid], this._y[eid]);
        this._observedGen[eid] = generation;
        this._observed[eid] = observed ? 1 : 0;
        return observed;
    }

    /**
     * The batch collecting (x, y)'s chunk, created on first use.
     * @private
     * @param {Map<number, PortItemBatchEvent>} batches
     * @param {number} x
     * @param {number} y
     * @returns {PortItemBatchEvent}
     */
    _batchAt(batches, x, y) {
        const chunk = chunkId(x, y);
        const existing = batches.get(chunk);
        if (existing !== undefined) {
            return existing;
        }
        const batch = new PortItemBatchEvent(x, y);
        batches.set(chunk, batch);
        return batch;
    }
}
