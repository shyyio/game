import {EMPTY} from "@/sim/sentinels.js";

// Initial row count for the per-tick intent/resolved columns; grows by doubling.
const INTENT_CAPACITY = 1024;

/**
 * The port-transfer protocol: mods submit intents, this resolves which of them actually move this
 * tick, empties the resolved sources at once, and fills the resolved destinations once the mods
 * have had their say.
 *
 * Both the intents and the resolutions are SoA: one row per submitted intent / resolved transfer,
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
        // destination-less drain.
        this._intentCapacity = INTENT_CAPACITY;
        this._intentSource = new Int32Array(INTENT_CAPACITY);
        this._intentDest = new Int32Array(INTENT_CAPACITY);
        this._intentOutput = new Int32Array(INTENT_CAPACITY);
        this._intentRank = new Int32Array(INTENT_CAPACITY);
        this._intentDestEmpty = new Uint8Array(INTENT_CAPACITY);
        this._intentResolved = new Uint8Array(INTENT_CAPACITY);
        this._intentCount = 0;

        // Resolved transfers.
        this._resolvedCapacity = INTENT_CAPACITY;
        this._resolvedSource = new Int32Array(INTENT_CAPACITY);
        this._resolvedDest = new Int32Array(INTENT_CAPACITY);
        this._resolvedItem = new Int32Array(INTENT_CAPACITY);
        this._resolvedCount = 0;

        // resolve()'s working lists, reused tick to tick. Each holds at most one entry per intent
        // row, so a single grow against the intent count sizes them all.
        this._scratchCapacity = INTENT_CAPACITY;
        this._touchedDests = new Int32Array(INTENT_CAPACITY);
        this._rankedSources = new Int32Array(INTENT_CAPACITY);

        // Per-port resolution, persisting through the tick (mods query it in POST_RESOLVE).
        // resolve() clears only the slots it touched, so no pass costs the width of the world.
        this._destBySource = new Int32Array(portCapacity).fill(EMPTY);
        this._portResolved = new Uint8Array(portCapacity);
        // Transient within resolve(): the winning/best intent row per port, whether the port empties
        // this tick, and the ports that do, in propagation order.
        this._winnerByDest = new Int32Array(portCapacity).fill(EMPTY);
        this._bestBySource = new Int32Array(portCapacity).fill(EMPTY);
        this._emptying = new Uint8Array(portCapacity);
        this._emptyingQueue = new Int32Array(portCapacity);
    }

    /**
     * @returns {number} intents submitted this tick
     */
    get intentCount() {
        return this._intentCount;
    }

    /**
     * @returns {number} intents resolved this tick
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
        for (const name of ["_portResolved", "_emptying"]) {
            const grown = new Uint8Array(capacity);
            grown.set(this[name]);
            this[name] = grown;
        }
        // Transient within one pass, so it is replaced rather than copied.
        this._emptyingQueue = new Int32Array(capacity);
    }

    /**
     * The destination a resolved transfer moves this source's item to this tick, or EMPTY.
     * @param {number} source
     * @returns {number}
     */
    getDestByPortEid(source) {
        return this._destBySource[source];
    }

    /**
     * Whether a transfer resolved into this destination this tick. Lets a producer detect its output
     * was delivered (its create intent is source-less, so destFor can't key on it).
     * @param {number} dest
     * @returns {boolean}
     */
    isDest(dest) {
        return dest !== EMPTY && this._portResolved[dest] === 1;
    }

    /**
     * Whether the intent submitted as row `intentRow` this tick resolved.
     * @param {number} intentRow
     * @returns {boolean}
     */
    isIntentResolved(intentRow) {
        return this._intentResolved[intentRow] === 1;
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
            }
        }
        this._intentResolved.fill(0, 0, this._intentCount);
        this._intentCount = 0;
        this._resolvedCount = 0;
    }

    /**
     * Submits a move of one item from `source` to `dest`. It resolves when `dest` empties this
     * tick: either `destEmpty` seeds that, or `dest` is itself the source of a resolving transfer or
     * drain, so a packed chain shifts as one. A port takes one intent per tick: lowest rank, then
     * lowest source eid.
     * @param {number} source - the port the item leaves
     * @param {number} dest - the port it lands in
     * @param {boolean} destEmpty - whether `dest` is free to take it right now
     * @param {number} [rank] - preference among one source's several destinations; lowest wins
     * @param {number} [outputItem] - what lands in `dest`, when the move translates the item type;
     *     without it the source's own item moves across
     * @returns {number} the intent row, for {@link isIntentResolved}
     */
    submitTransfer(source, dest, destEmpty, rank=EMPTY, outputItem=EMPTY) {
        return this._pushIntent(source, dest, destEmpty, rank, outputItem);
    }

    /**
     * Submits a producer's source-less create of `item` into `dest`.
     * @param {number} dest
     * @param {number} item
     * @param {boolean} destEmpty
     * @returns {number} the intent row, for {@link isIntentResolved}
     */
    submitCreate(dest, item, destEmpty) {
        return this._pushIntent(EMPTY, dest, destEmpty, EMPTY, item);
    }

    /**
     * Submits a destination-less drain: `source` is emptied this tick, so whatever feeds it can
     * resolve.
     * @param {number} source
     * @returns {number} the intent row, for {@link isIntentResolved}
     */
    submitDrain(source) {
        return this._pushIntent(source, EMPTY, false, EMPTY, EMPTY);
    }

    /**
     * Appends one intent row.
     * @private
     * @param {number} source
     * @param {number} dest
     * @param {boolean} destEmpty
     * @param {number} rank
     * @param {number} outputItem
     * @returns {number} the intent row
     */
    _pushIntent(source, dest, destEmpty, rank, outputItem) {
        const row = this._intentCount;
        this._growIntents(row);
        this._intentSource[row] = source;
        this._intentDest[row] = dest;
        this._intentOutput[row] = outputItem;
        this._intentRank[row] = rank;
        this._intentDestEmpty[row] = destEmpty ? 1 : 0;
        this._intentCount = row + 1;
        return row;
    }

    /**
     * Resolves this tick's intents into resolved transfers via a linear backward propagation over
     * the functional transfer graph, then empties the resolved sources. Closes SUBMIT_INTENTS.
     * @returns {void}
     */
    resolve() {
        const count = this._intentCount;
        const source = this._intentSource;
        const dest = this._intentDest;
        const rank = this._intentRank;
        const destEmpty = this._intentDestEmpty;
        const winner = this._winnerByDest;
        const emptying = this._emptying;
        this._growScratch(count);
        // Destinations whose winner slot was touched, so the reset at the end walks only those.
        const touchedDests = this._touchedDests;
        // The ports emptying this tick; doubles as the reset list for `emptying`.
        const queue = this._emptyingQueue;
        let destCount = 0;
        let queueCount = 0;

        // Pass 1: dedup contenders per destination (a port takes one) — lowest rank wins, tie by
        // source. A destination-less row resolves outright and empties its source.
        for (let row = 0; row < count; row += 1) {
            if (dest[row] === EMPTY) {
                if (source[row] === EMPTY) {
                    continue;
                }
                this._recordResolved(row);
                if (emptying[source[row]] === 0) {
                    emptying[source[row]] = 1;
                    queue[queueCount] = source[row];
                    queueCount += 1;
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

        // A destination that is free right now (destEmpty) empties too, which is what seeds the
        // propagation.
        for (let index = 0; index < destCount; index += 1) {
            const port = touchedDests[index];
            if (destEmpty[winner[port]] === 1 && emptying[port] === 0) {
                emptying[port] = 1;
                queue[queueCount] = port;
                queueCount += 1;
            }
        }

        // Pass 2: a transfer resolves if its destination empties this tick, which empties its own
        // source in turn (a packed chain shifts as one). Each port enters the queue once, so each
        // winning row resolves once. A fan-out source defers to pass 3.
        const best = this._bestBySource;
        const ranked = this._rankedSources;
        let rankedCount = 0;
        for (let head = 0; head < queueCount; head += 1) {
            const row = winner[queue[head]];
            if (row === EMPTY) {
                continue;
            }
            if (rank[row] === EMPTY) {
                this._recordResolved(row);
            } else {
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
            if (source[row] !== EMPTY && emptying[source[row]] === 0) {
                emptying[source[row]] = 1;
                queue[queueCount] = source[row];
                queueCount += 1;
            }
        }

        // Pass 3: a fan-out source keeps only its best-ranked resolved destination.
        for (let index = 0; index < rankedCount; index += 1) {
            const port = ranked[index];
            this._recordResolved(best[port]);
            best[port] = EMPTY;
        }

        for (let index = 0; index < destCount; index += 1) {
            winner[touchedDests[index]] = EMPTY;
        }
        for (let index = 0; index < queueCount; index += 1) {
            emptying[queue[index]] = 0;
        }

        this._clearSources();
    }

    /**
     * Records one resolved transfer, capturing the moved item now (before the sources empty): the
     * destination receives output_item if set, else the source's item.
     * @private
     * @param {number} intentRow
     * @returns {void}
     */
    _recordResolved(intentRow) {
        this._intentResolved[intentRow] = 1;
        const source = this._intentSource[intentRow];
        const dest = this._intentDest[intentRow];
        let item = this._intentOutput[intentRow];
        if (item === EMPTY && source !== EMPTY) {
            item = this.engine.Port.item[source];
        }

        const row = this._resolvedCount;
        this._growResolved(row);
        this._resolvedSource[row] = source;
        this._resolvedDest[row] = dest;
        this._resolvedItem[row] = item;
        this._resolvedCount = row + 1;

        // First transfer wins
        if (source !== EMPTY && this._destBySource[source] === EMPTY) {
            this._destBySource[source] = dest;
        }
        if (dest !== EMPTY) {
            this._portResolved[dest] = 1;
        }
    }

    /**
     * Empties every resolved source. Runs with the resolution, before POST_RESOLVE, so a transport
     * refilling a source the same tick lands on an empty port.
     * @private
     * @returns {void}
     */
    _clearSources() {
        for (let row = 0; row < this._resolvedCount; row += 1) {
            const source = this._resolvedSource[row];
            if (source !== EMPTY) {
                this.engine.ports.consumeItem(source);
            }
        }
    }

    /**
     * Writes every resolved transfer's item into its destination. Runs after the POST_RESOLVE
     * systems, so a landed item rests a visible tick before anything reads it.
     * @returns {void}
     */
    fillDestinations() {
        const engine = this.engine;
        for (let row = 0; row < this._resolvedCount; row += 1) {
            const dest = this._resolvedDest[row];
            if (dest !== EMPTY) {
                engine.Port.item[dest] = this._resolvedItem[row];
                engine.portItems.markDirty(dest);
            }
        }
    }

    /**
     * The resolved real transfers (both ends real ports) as "source->dest", ordered by source.
     * @returns {string}
     */
    getResolvedEdges() {
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
        for (const name of ["_touchedDests", "_rankedSources"]) {
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
        for (const name of ["_intentDestEmpty", "_intentResolved"]) {
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
        this._resolvedCapacity = capacity;
    }
}
