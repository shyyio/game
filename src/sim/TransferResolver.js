import {EMPTY} from "@/sim/sentinels.js";

// Initial row count for the per-tick intent/resolved columns; grows by doubling.
const INTENT_CAPACITY = 1024;

// Intent flag bits.
const INTENT_DEST_EMPTY = 1;
const INTENT_MANAGED = 2;

/**
 * The port-transfer protocol: mods submit intents in SUBMIT_INTENTS, this resolves which of them
 * actually move this tick, and COMMIT_TRANSFERS applies the managed ones to the ports.
 *
 * Both the intents and the resolutions are SoA: one row per submitted intent / committed transfer,
 * so a tick's several hundred thousand rows cost no object headers.
 */
export class TransferResolver {

    /**
     * @param {GameEngine} engine
     * @param {number} portCapacity - the Port component's current column length
     */
    constructor(engine, portCapacity) {
        this.engine = engine;

        // Submitted this tick. source/dest are port eids, or EMPTY for a source-less create /
        // destination-less drain; flags carry destEmpty and managed.
        this._intentCapacity = INTENT_CAPACITY;
        this._intentSource = new Int32Array(INTENT_CAPACITY);
        this._intentDest = new Int32Array(INTENT_CAPACITY);
        this._intentOutput = new Int32Array(INTENT_CAPACITY);
        this._intentRank = new Int32Array(INTENT_CAPACITY);
        this._intentFlags = new Uint8Array(INTENT_CAPACITY);
        this._intentSeen = new Uint8Array(INTENT_CAPACITY);
        this._intentCount = 0;

        // Committed transfers.
        this._resolvedCapacity = INTENT_CAPACITY;
        this._resolvedSource = new Int32Array(INTENT_CAPACITY);
        this._resolvedDest = new Int32Array(INTENT_CAPACITY);
        this._resolvedItem = new Int32Array(INTENT_CAPACITY);
        this._resolvedManaged = new Uint8Array(INTENT_CAPACITY);
        this._resolvedCount = 0;

        // resolve()'s working lists, reused tick to tick. Every one of them holds at most one entry
        // per intent row, so a single grow against the intent count sizes them all.
        this._scratchCapacity = INTENT_CAPACITY;
        this._touchedDests = new Int32Array(INTENT_CAPACITY);
        this._touchedSources = new Int32Array(INTENT_CAPACITY);
        this._drainQueue = new Int32Array(INTENT_CAPACITY);
        this._resolvedRows = new Int32Array(INTENT_CAPACITY);
        this._rankedSources = new Int32Array(INTENT_CAPACITY);
        // Managed destination-less sources the engine drains this tick.
        this._sinks = new Int32Array(INTENT_CAPACITY);
        this._sinkCount = 0;

        // Per-port resolution, persisting through the tick (mods query it in POST_RESOLVE). resolve()
        // clears only the slots it touched, so no pass costs the width of the world.
        this._destBySource = new Int32Array(portCapacity).fill(EMPTY);
        this._portResolved = new Uint8Array(portCapacity);
        this._portResolvedUnmanaged = new Uint8Array(portCapacity);
        // Transient within resolve(): the winning/best intent row per port, and whether the port
        // empties this tick.
        this._winnerByDest = new Int32Array(portCapacity).fill(EMPTY);
        this._bestBySource = new Int32Array(portCapacity).fill(EMPTY);
        this._draining = new Uint8Array(portCapacity);
    }

    /**
     * @returns {number} intents submitted this tick
     */
    get intentCount() {
        return this._intentCount;
    }

    /**
     * @returns {number} transfers resolved this tick
     */
    get resolvedCount() {
        return this._resolvedCount;
    }

    /**
     * Grows the per-port columns with the Port component.
     * @param {number} capacity
     * @returns {void}
     */
    growPortColumns(capacity) {
        for (const name of ["_destBySource", "_winnerByDest", "_bestBySource"]) {
            const grown = new Int32Array(capacity).fill(EMPTY);
            grown.set(this[name]);
            this[name] = grown;
        }
        for (const name of ["_portResolved", "_portResolvedUnmanaged", "_draining"]) {
            const grown = new Uint8Array(capacity);
            grown.set(this[name]);
            this[name] = grown;
        }
    }

    /**
     * The destination a resolved transfer moved this source's item to this tick, or EMPTY. Lets a mod
     * doing its own (managed=0) move read the engine's resolution.
     * @param {number} source
     * @returns {number}
     */
    destFor(source) {
        return this._destBySource[source];
    }

    /**
     * Whether a transfer resolved into this destination this tick. Lets a producer detect its output
     * was delivered (its create intent is source-less, so destFor can't key on it).
     * @param {number} dest
     * @returns {boolean}
     */
    wasDest(dest) {
        return dest !== EMPTY && this._portResolved[dest] === 1;
    }

    /**
     * As {@link wasDest} but only for unmanaged (managed=0) transfers — the form belts submit, where a
     * resolved out-port means the path may pop this tick.
     * @param {number} dest
     * @returns {boolean}
     */
    wasUnmanagedDest(dest) {
        return dest !== EMPTY && this._portResolvedUnmanaged[dest] === 1;
    }

    /**
     * Clears this tick's transient transfer buffers.
     * @returns {void}
     */
    resetTick() {
        // Clear last tick's per-port resolution, walking only the ports it actually touched.
        for (let row = 0; row < this._resolvedCount; row += 1) {
            const source = this._resolvedSource[row];
            if (source !== EMPTY) {
                this._destBySource[source] = EMPTY;
            }
            const dest = this._resolvedDest[row];
            if (dest !== EMPTY) {
                this._portResolved[dest] = 0;
                this._portResolvedUnmanaged[dest] = 0;
            }
        }
        this._intentCount = 0;
        this._resolvedCount = 0;
        this._sinkCount = 0;
    }

    /**
     * Submits a move of one item from `source` to `dest`.
     * @param {number} source - the port the item leaves
     * @param {number} dest - the port it lands in
     * @param {boolean} destEmpty - whether `dest` is free to take it right now
     * @param {boolean} managed - whether the engine moves the item (false: the mod moves it itself and
     *     only reads the resolution)
     * @param {number} [rank] - preference among one source's several destinations; lowest wins
     * @param {number} [outputItem] - what lands in `dest`, when the move translates the item type;
     *     without it the source's own item moves across
     * @returns {void}
     */
    submitTransfer(source, dest, destEmpty, managed, rank=EMPTY, outputItem=EMPTY) {
        this._pushIntent(source, dest, destEmpty, managed, outputItem, rank);
    }

    /**
     * Submits a producer's source-less create of `item` into `dest`.
     * @param {number} dest
     * @param {number} item
     * @param {boolean} destEmpty
     * @returns {void}
     */
    submitCreate(dest, item, destEmpty) {
        this._pushIntent(EMPTY, dest, destEmpty, true, item, EMPTY);
    }

    /**
     * Submits a destination-less drain: `source` empties this tick, so whatever feeds it can resolve.
     * A managed drain is also cleared by the engine in CONSUME_INPUTS.
     * @param {number} source
     * @param {boolean} managed
     * @returns {void}
     */
    submitDrain(source, managed) {
        this._pushIntent(source, EMPTY, false, managed, EMPTY, EMPTY);
    }

    /**
     * Appends one intent row.
     * @private
     * @param {number} source
     * @param {number} dest
     * @param {boolean} destEmpty
     * @param {boolean} managed
     * @param {number} outputItem
     * @param {number} rank
     * @returns {void}
     */
    _pushIntent(source, dest, destEmpty, managed, outputItem, rank) {
        const row = this._intentCount;
        this._growIntents(row);
        this._intentSource[row] = source;
        this._intentDest[row] = dest;
        this._intentOutput[row] = outputItem;
        this._intentRank[row] = rank;
        let flags = 0;
        if (destEmpty) {
            flags |= INTENT_DEST_EMPTY;
        }
        if (managed) {
            flags |= INTENT_MANAGED;
        }
        this._intentFlags[row] = flags;
        this._intentSeen[row] = 0;
        this._intentCount = row + 1;
    }

    /**
     * RESOLVE_TRANSFERS: resolves this tick's intents into resolved transfers via a linear backward
     * propagation over the functional transfer graph.
     * @returns {void}
     */
    resolve() {
        const count = this._intentCount;
        const source = this._intentSource;
        const dest = this._intentDest;
        const rank = this._intentRank;
        const flags = this._intentFlags;
        const winner = this._winnerByDest;
        const draining = this._draining;
        this._growScratch(count);
        // Ports whose transient scratch was touched, so the reset at the end walks only those.
        const touchedDests = this._touchedDests;
        const touchedSources = this._touchedSources;
        const queue = this._drainQueue;
        const resolvedRows = this._resolvedRows;
        const sinks = this._sinks;
        let destCount = 0;
        let sourceCount = 0;
        let queueCount = 0;
        let resolvedRowCount = 0;
        let sinkCount = 0;

        // Pass 1: dedup contenders per destination (a port takes one) — lowest rank wins, tie by
        // source. Destination-less rows mark their source as draining this tick, and a managed one
        // also becomes a sink the engine drains in commit.
        for (let row = 0; row < count; row += 1) {
            if (dest[row] === EMPTY) {
                if (source[row] === EMPTY) {
                    continue;
                }
                if ((flags[row] & INTENT_MANAGED) !== 0) {
                    sinks[sinkCount] = source[row];
                    sinkCount += 1;
                }
                if (draining[source[row]] === 0) {
                    draining[source[row]] = 1;
                    queue[queueCount] = source[row];
                    queueCount += 1;
                    touchedSources[sourceCount] = source[row];
                    sourceCount += 1;
                }
                continue;
            }
            const current = winner[dest[row]];
            if (current === EMPTY) {
                touchedDests[destCount] = dest[row];
                destCount += 1;
            }
            if (current === EMPTY
                || rank[row] < rank[current]
                || (rank[row] === rank[current] && source[row] < source[current])) {
                winner[dest[row]] = row;
            }
        }
        this._sinkCount = sinkCount;

        // Pass 2: a transfer resolves if its destination empties this tick — the destination is
        // empty (destEmpty), or drains, or is itself a resolving source (packed chain shifts as one).
        // Propagate backward: when a port joins the draining set, the transfer feeding it resolves.
        for (let index = 0; index < destCount; index += 1) {
            const row = winner[touchedDests[index]];
            if ((flags[row] & INTENT_DEST_EMPTY) === 0) {
                continue;
            }
            resolvedRows[resolvedRowCount] = row;
            resolvedRowCount += 1;
            this._intentSeen[row] = 1;
            if (source[row] !== EMPTY && draining[source[row]] === 0) {
                draining[source[row]] = 1;
                queue[queueCount] = source[row];
                queueCount += 1;
                touchedSources[sourceCount] = source[row];
                sourceCount += 1;
            }
        }

        for (let head = 0; head < queueCount; head += 1) {
            const row = winner[queue[head]];
            if (row === EMPTY || this._intentSeen[row] === 1) {
                continue;
            }
            resolvedRows[resolvedRowCount] = row;
            resolvedRowCount += 1;
            this._intentSeen[row] = 1;
            if (source[row] !== EMPTY && draining[source[row]] === 0) {
                draining[source[row]] = 1;
                queue[queueCount] = source[row];
                queueCount += 1;
                touchedSources[sourceCount] = source[row];
                sourceCount += 1;
            }
        }

        // Pass 3: per-source pick. Single-destination sources pass through; a fan-out source keeps
        // only its best-ranked resolved destination.
        const best = this._bestBySource;
        const ranked = this._rankedSources;
        let rankedCount = 0;
        for (let index = 0; index < resolvedRowCount; index += 1) {
            const row = resolvedRows[index];
            if (rank[row] === EMPTY) {
                this._commitResolved(row);
                continue;
            }
            const current = best[source[row]];
            if (current === EMPTY) {
                ranked[rankedCount] = source[row];
                rankedCount += 1;
            }
            if (current === EMPTY
                || rank[row] < rank[current]
                || (rank[row] === rank[current] && dest[row] < dest[current])) {
                best[source[row]] = row;
            }
        }
        for (let index = 0; index < rankedCount; index += 1) {
            const port = ranked[index];
            this._commitResolved(best[port]);
            best[port] = EMPTY;
        }

        for (let index = 0; index < destCount; index += 1) {
            winner[touchedDests[index]] = EMPTY;
        }
        for (let index = 0; index < sourceCount; index += 1) {
            draining[touchedSources[index]] = 0;
        }
    }

    /**
     * Records one resolved transfer, capturing the moved item now (before commit mutates ports).
     * Managed: the destination receives output_item if set, else the source's item. Unmanaged: the
     * owning mod moves it, so the engine records no item.
     * @private
     * @param {number} intentRow
     * @returns {void}
     */
    _commitResolved(intentRow) {
        const source = this._intentSource[intentRow];
        const dest = this._intentDest[intentRow];
        const managed = (this._intentFlags[intentRow] & INTENT_MANAGED) !== 0;
        const outputItem = this._intentOutput[intentRow];
        const sourceItem = source === EMPTY ? EMPTY : this.engine.Port.item[source];
        let item = EMPTY;
        if (managed) {
            if (outputItem !== EMPTY) {
                item = outputItem;
            } else {
                item = sourceItem;
            }
        }

        const row = this._resolvedCount;
        this._growResolved(row);
        this._resolvedSource[row] = source;
        this._resolvedDest[row] = dest;
        this._resolvedItem[row] = item;
        this._resolvedManaged[row] = managed ? 1 : 0;
        this._resolvedCount = row + 1;

        // First transfer wins, matching the find() this index replaced.
        if (source !== EMPTY && this._destBySource[source] === EMPTY) {
            this._destBySource[source] = dest;
        }
        this._portResolved[dest] = 1;
        if (!managed) {
            this._portResolvedUnmanaged[dest] = 1;
        }
    }

    /**
     * CONSUME_INPUTS: drains resolved managed sinks. Runs before POST_RESOLVE so a producer feeding
     * the same port refills it the same tick.
     * @returns {void}
     */
    flushSinks() {
        for (let index = 0; index < this._sinkCount; index += 1) {
            this.engine.consumePortItem(this._sinks[index]);
        }
    }

    /**
     * COMMIT_TRANSFERS: applies resolved managed transfers to Port — clears sources, then writes
     * destinations, so a packed chain shifts atomically.
     * @returns {void}
     */
    commit() {
        const engine = this.engine;
        for (let row = 0; row < this._resolvedCount; row += 1) {
            const source = this._resolvedSource[row];
            if (this._resolvedManaged[row] === 1 && source !== EMPTY) {
                engine.consumePortItem(source);
            }
        }
        for (let row = 0; row < this._resolvedCount; row += 1) {
            const dest = this._resolvedDest[row];
            if (this._resolvedManaged[row] === 1 && dest !== EMPTY) {
                engine.Port.item[dest] = this._resolvedItem[row];
                engine.markPortDirty(dest);
            }
        }
    }

    /**
     * The resolved real transfers (both ends real ports) as "source->dest", ordered by source.
     * @returns {string}
     */
    resolvedEdges() {
        const edges = [];
        for (let row = 0; row < this._resolvedCount; row += 1) {
            if (this._resolvedSource[row] !== EMPTY && this._resolvedDest[row] !== EMPTY) {
                edges.push({source: this._resolvedSource[row], dest: this._resolvedDest[row]});
            }
        }
        return edges
            .sort((a, b) => a.source - b.source)
            .map(edge => `${edge.source}->${edge.dest}`)
            .join(", ");
    }

    /**
     * Grows the resolver's working lists so `count` entries fit in each. Runs before any of them is
     * written this tick, so the old contents are dropped rather than copied.
     * @private
     * @param {number} count
     * @returns {void}
     */
    _growScratch(count) {
        if (count < this._scratchCapacity) {
            return;
        }
        let capacity = this._scratchCapacity;
        while (capacity <= count) {
            capacity *= 2;
        }
        for (const name of ["_touchedDests", "_touchedSources", "_drainQueue", "_resolvedRows", "_rankedSources", "_sinks"]) {
            this[name] = new Int32Array(capacity);
        }
        this._scratchCapacity = capacity;
    }

    /**
     * Grows the intent columns so row `count` is addressable.
     * @private
     * @param {number} count
     * @returns {void}
     */
    _growIntents(count) {
        if (count < this._intentCapacity) {
            return;
        }
        let capacity = this._intentCapacity;
        while (capacity <= count) {
            capacity *= 2;
        }
        for (const name of ["_intentSource", "_intentDest", "_intentOutput", "_intentRank"]) {
            const grown = new Int32Array(capacity);
            grown.set(this[name]);
            this[name] = grown;
        }
        for (const name of ["_intentFlags", "_intentSeen"]) {
            const grown = new Uint8Array(capacity);
            grown.set(this[name]);
            this[name] = grown;
        }
        this._intentCapacity = capacity;
    }

    /**
     * Grows the resolved-transfer columns so row `count` is addressable.
     * @private
     * @param {number} count
     * @returns {void}
     */
    _growResolved(count) {
        if (count < this._resolvedCapacity) {
            return;
        }
        let capacity = this._resolvedCapacity;
        while (capacity <= count) {
            capacity *= 2;
        }
        for (const name of ["_resolvedSource", "_resolvedDest", "_resolvedItem"]) {
            const grown = new Int32Array(capacity);
            grown.set(this[name]);
            this[name] = grown;
        }
        const managed = new Uint8Array(capacity);
        managed.set(this._resolvedManaged);
        this._resolvedManaged = managed;
        this._resolvedCapacity = capacity;
    }
}
