import {createWorld, addEntity, addComponent} from "bitecs";
import {SimEngine} from "@/common/sim/SimEngine.js";
import {TickPhase} from "@/common/core.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";

// Port.item sentinel for an empty port (item types are >= 0, so -1 is unambiguous).
export const EMPTY = -1;

// Initial Port column length; grows by doubling when an eid exceeds it.
const PORT_CAPACITY = 1024;

/**
 * bitECS-backed simulation runtime. This slice implements the port-transfer core (the SQL
 * ResolvePortTransfer pipeline) over typed-array component storage; mods are migrated onto it phase
 * by phase behind the shared {@link SimEngine} contract.
 */
export class EcsEngine extends SimEngine {

    constructor() {
        super();

        /**
         * @type {World|null}
         */
        this.world = null;

        // Port component: item type per port eid, EMPTY when unoccupied. Backed by a typed array
        // indexed directly by eid (bitECS recycles eids densely), grown by _ensurePortCapacity.
        this.Port = {item: new Int32Array(PORT_CAPACITY).fill(EMPTY)};
        this._portCapacity = PORT_CAPACITY;
        // Shared ports by edge key "x,y,direction" (see portAt).
        this._portsByEdge = new Map();
        // Global client-facing object id (BigInt), shared across all object types so ids never collide.
        this._nextObjectId = 1n;
        // Occupied cells: "x,y,layer" (layer "S" = surface, "U0"/"U1" = underground axis). Objects on
        // the same layer collide; different layers coexist (an underground crosses under a surface belt).
        this._occupied = new Set();

        // Per-phase system lists, run in order by tick(phase).
        this.systems = {
            [TickPhase.SUBMIT_INTENTS]: [() => this._resetTick()],
            [TickPhase.RESOLVE_TRANSFERS]: [() => this.resolvePortTransfer()],
            [TickPhase.CONSUME_INPUTS]: [() => this.flushSinks()],
            [TickPhase.POST_RESOLVE]: [],
            [TickPhase.PRODUCE_OUTPUTS]: [],
            [TickPhase.COMMIT_TRANSFERS]: [() => this.commitTransfers()],
            [TickPhase.EMIT_RENDER]: [() => this._emitRender()],
            [TickPhase.EMIT_INSPECT]: [],
        };

        // Out-ports whose resting item is drawn: eid -> {x, y}. Modules register theirs. Keyed so
        // re-registration is idempotent and a removed path's port can be unregistered (paths churn).
        this.renderedPorts = new Map();
        // Last emitted item per rendered port, so EMIT_RENDER emits only changes.
        this._portShadow = new Map();
        // Ports unregistered while holding a rendered item (eid -> {x, y}): a pending clear, cancelled if
        // the port is re-registered in the same edit (so a churned-but-surviving port stays static, no
        // clear+set glide). Flushed by the render diff.
        this._pendingClear = new Map();
        // Buffered domain events (placement/path/delete + port-item render deltas) awaiting broadcast by chunk.
        this._events = [];

        this._resetTick();
    }

    /**
     * Buffers a domain event (a real GameEvent) for the owner to broadcast to sessions covering its
     * chunk.
     * @param {AbstractTilePositionedEvent} event
     * @returns {void}
     */
    emitEvent(event) {
        this._events.push(event);
    }

    /**
     * Returns and clears the buffered domain events.
     * @returns {AbstractTilePositionedEvent[]}
     */
    drainEvents() {
        const events = this._events;
        this._events = [];
        return events;
    }

    /**
     * Registers an out-port whose resting item is drawn at tile (x, y); EMIT_RENDER emits a set/clear
     * event whenever its item changes.
     * @param {number} eid
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    registerRenderedPort(eid, x, y) {
        this.renderedPorts.set(eid, {x, y});
        // A re-registered port survives the edit: cancel any pending clear so its sprite stays put
        // (item unchanged -> the diff emits nothing) instead of a clear+set that glides in a new sprite.
        this._pendingClear.delete(eid);
    }

    /**
     * Stops drawing a port (its path was removed). If it held a rendered item, the clear is deferred to
     * the next render diff so a same-edit re-registration can cancel it (keeping a surviving port static).
     * @param {number} eid
     * @returns {void}
     */
    unregisterRenderedPort(eid) {
        const position = this.renderedPorts.get(eid);
        if (this._portShadow.has(eid) && position !== undefined) {
            this._pendingClear.set(eid, position);
        }
        this.renderedPorts.delete(eid);
    }

    /**
     * EMIT_RENDER: flush deferred clears (ports unregistered for good), then diff each rendered port's
     * item against the shadow, buffering a set (item appeared or changed) or clear (item left) event.
     * @private
     * @returns {void}
     */
    _emitRender() {
        this._pendingClear.forEach((position, eid) => {
            this.emitEvent(new PortItemClearEvent(position.x, position.y, BigInt(eid)));
            this._portShadow.delete(eid);
        });
        this._pendingClear.clear();

        this.renderedPorts.forEach((position, eid) => {
            const item = this.Port.item[eid];
            const previous = this._portShadow.has(eid) ? this._portShadow.get(eid) : EMPTY;
            if (item === previous) {
                return;
            }
            if (item === EMPTY) {
                this.emitEvent(new PortItemClearEvent(position.x, position.y, BigInt(eid)));
                this._portShadow.delete(eid);
            } else {
                this.emitEvent(new PortItemSetEvent(position.x, position.y, BigInt(eid), item));
                this._portShadow.set(eid, item);
            }
        });
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
        this.world = createWorld();
    }

    /**
     * @param {TickPhase} phase
     * @returns {void}
     */
    tick(phase) {
        this.systems[phase].forEach(system => {
            system();
        });
    }

    /**
     * Appends a system to a phase, run after the ones already registered. Mods wire their behavior in
     * this way.
     * @param {TickPhase} phase
     * @param {function(): void} system
     * @returns {void}
     */
    registerSystem(phase, system) {
        this.systems[phase].push(system);
    }

    /**
     * The destination a resolved transfer moved this source's item to this tick, or EMPTY. Lets a mod
     * doing its own (managed=0) move read the engine's resolution.
     * @param {number} source
     * @returns {number}
     */
    resolvedDestFor(source) {
        const transfer = this._resolved.find(candidate => candidate.source === source);
        if (transfer === undefined) {
            return EMPTY;
        }
        return transfer.dest;
    }

    /**
     * Whether a transfer resolved into this destination this tick. Lets a producer detect its output
     * was delivered (its create intent is source-less, so resolvedDestFor can't key on it).
     * @param {number} dest
     * @returns {boolean}
     */
    wasResolvedDest(dest) {
        return this._resolved.some(transfer => transfer.dest === dest);
    }

    /**
     * As {@link wasResolvedDest} but only for unmanaged (managed=0) transfers — the form belts submit,
     * where a resolved out-port means the path may pop this tick.
     * @param {number} dest
     * @returns {boolean}
     */
    resolvedUnmanagedDest(dest) {
        return this._resolved.some(transfer => transfer.dest === dest && transfer.managed === false);
    }

    /**
     * Clears this tick's transient transfer buffers.
     * @private
     * @returns {void}
     */
    _resetTick() {
        // Submitted this tick: {source, dest, destEmpty, managed, outputItem, rank}. source/dest are
        // port eids, or EMPTY for a source-less create / destination-less drain.
        this._intents = [];
        // Committed transfers: {source, dest, item, managed}.
        this._resolved = [];
        // Managed destination-less sources the engine drains this tick.
        this._sinks = [];
    }

    /**
     * @private
     * @param {number} eid
     * @returns {void}
     */
    _ensurePortCapacity(eid) {
        if (eid < this._portCapacity) {
            return;
        }
        let capacity = this._portCapacity;
        while (capacity <= eid) {
            capacity *= 2;
        }
        const grown = new Int32Array(capacity).fill(EMPTY);
        grown.set(this.Port.item);
        this.Port.item = grown;
        this._portCapacity = capacity;
    }

    /**
     * Creates a port carrying `item` (EMPTY for an empty port).
     * @param {number} [item]
     * @returns {number} the port eid
     */
    addPort(item=EMPTY) {
        const eid = addEntity(this.world);
        addComponent(this.world, eid, this.Port);
        this._ensurePortCapacity(eid);
        this.Port.item[eid] = item;
        return eid;
    }

    /**
     * The shared port on the edge "flow entering tile (x, y) going `direction`", created once and
     * reused. Both the upstream producer (whose output lands here) and the downstream consumer (whose
     * input is here) resolve the same port, so belts, chunk seams, and objects adopt each other's ports.
     * @param {number} x
     * @param {number} y
     * @param {number} direction
     * @returns {number} the port eid
     */
    portAt(x, y, direction) {
        const key = `${x},${y},${direction}`;
        let eid = this._portsByEdge.get(key);
        if (eid === undefined) {
            eid = this.addPort();
            this._portsByEdge.set(key, eid);
        }
        return eid;
    }

    /**
     * Whether every cell {x, y, layer} is free.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @returns {boolean}
     */
    occupancyFree(cells) {
        return cells.every(cell => !this._occupied.has(`${cell.x},${cell.y},${cell.layer}`));
    }

    /**
     * Marks each cell occupied.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @returns {void}
     */
    occupy(cells) {
        cells.forEach(cell => this._occupied.add(`${cell.x},${cell.y},${cell.layer}`));
    }

    /**
     * Frees each cell.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @returns {void}
     */
    release(cells) {
        cells.forEach(cell => this._occupied.delete(`${cell.x},${cell.y},${cell.layer}`));
    }

    /**
     * Allocates the next global client-facing object id.
     * @returns {BigInt}
     */
    allocateObjectId() {
        const id = this._nextObjectId;
        this._nextObjectId += 1n;
        return id;
    }

    /**
     * @param {number} eid
     * @returns {number} the port's item, or EMPTY
     */
    portItem(eid) {
        return this.Port.item[eid];
    }

    /**
     * @param {number} eid
     * @param {number} item
     * @returns {void}
     */
    setPortItem(eid, item) {
        this.Port.item[eid] = item;
    }

    /**
     * @param {{source:number, dest:number, destEmpty?:boolean, managed?:boolean, outputItem?:number, rank?:number}} intent
     * @returns {void}
     */
    submitIntent(intent) {
        this._intents.push({
            source: intent.source,
            dest: intent.dest,
            destEmpty: intent.destEmpty === true,
            managed: intent.managed === undefined ? true : intent.managed,
            outputItem: intent.outputItem === undefined ? EMPTY : intent.outputItem,
            rank: intent.rank === undefined ? EMPTY : intent.rank,
        });
    }

    /**
     * Resolves this tick's intents into ResolvedPortTransfer rows, replacing the SQL recursive-CTE
     * ResolvePortTransfer with a linear backward propagation over the functional transfer graph.
     * @returns {void}
     */
    resolvePortTransfer() {
        // Pass 1: dedup contenders per destination (a port takes one) — lowest rank wins, tie by
        // source. Destination-less rows mark their source as draining this tick.
        const winnerByDest = new Map();
        const drains = new Set();
        this._intents.forEach(intent => {
            if (intent.dest === EMPTY) {
                if (intent.source !== EMPTY) {
                    drains.add(intent.source);
                }
                return;
            }
            const current = winnerByDest.get(intent.dest);
            if (current === undefined
                || intent.rank < current.rank
                || (intent.rank === current.rank && intent.source < current.source)) {
                winnerByDest.set(intent.dest, intent);
            }
        });

        // Pass 2: a transfer resolves if its destination empties this tick — the destination is
        // empty (destEmpty), or drains, or is itself a resolving source (packed chain shifts as one).
        // Propagate backward: when a port joins the draining set, the transfer feeding it resolves.
        const resolvedSource = new Set(drains);
        const resolvedIntents = [];
        const seen = new Set();
        const queue = [...drains];

        winnerByDest.forEach(intent => {
            if (intent.destEmpty) {
                resolvedIntents.push(intent);
                seen.add(intent);
                if (!resolvedSource.has(intent.source)) {
                    resolvedSource.add(intent.source);
                    queue.push(intent.source);
                }
            }
        });

        while (queue.length > 0) {
            const port = queue.shift();
            const intent = winnerByDest.get(port);
            if (intent === undefined || seen.has(intent)) {
                continue;
            }
            resolvedIntents.push(intent);
            seen.add(intent);
            if (!resolvedSource.has(intent.source)) {
                resolvedSource.add(intent.source);
                queue.push(intent.source);
            }
        }

        // Pass 3: per-source pick. Single-destination sources pass through; a fan-out source keeps
        // only its best-ranked resolved destination.
        const bestBySource = new Map();
        resolvedIntents.forEach(intent => {
            if (intent.rank === EMPTY) {
                this._commitResolved(intent);
                return;
            }
            const current = bestBySource.get(intent.source);
            if (current === undefined
                || intent.rank < current.rank
                || (intent.rank === current.rank && intent.dest < current.dest)) {
                bestBySource.set(intent.source, intent);
            }
        });
        bestBySource.forEach(intent => {
            this._commitResolved(intent);
        });

        // Managed destination-less sinks always resolve; the engine drains them in commit.
        this._intents.forEach(intent => {
            if (intent.dest === EMPTY && intent.managed && intent.source !== EMPTY) {
                this._sinks.push(intent.source);
            }
        });
    }

    /**
     * Records one resolved transfer, capturing the moved item now (before commit mutates ports).
     * Managed: the destination receives output_item if set, else the source's item. Unmanaged: the
     * owning mod moves it, so the engine records no item.
     * @private
     * @param {object} intent
     * @returns {void}
     */
    _commitResolved(intent) {
        const sourceItem = intent.source === EMPTY ? EMPTY : this.Port.item[intent.source];
        const item = intent.managed
            ? (intent.outputItem !== EMPTY ? intent.outputItem : sourceItem)
            : EMPTY;
        this._resolved.push({
            source: intent.source,
            dest: intent.dest,
            item: item,
            managed: intent.managed,
        });
    }

    /**
     * CONSUME_INPUTS: drains resolved managed sinks. Runs before POST_RESOLVE so a producer feeding
     * the same port refills it the same tick (matches the SQL FlushResolvedSink placement).
     * @returns {void}
     */
    flushSinks() {
        this._sinks.forEach(source => {
            this.Port.item[source] = EMPTY;
        });
    }

    /**
     * COMMIT_TRANSFERS: applies resolved managed transfers to Port — clears sources, then writes
     * destinations, so a packed chain shifts atomically.
     * @returns {void}
     */
    commitTransfers() {
        this._resolved.forEach(transfer => {
            if (transfer.managed && transfer.source !== EMPTY) {
                this.Port.item[transfer.source] = EMPTY;
            }
        });
        this._resolved.forEach(transfer => {
            if (transfer.managed && transfer.dest !== EMPTY) {
                this.Port.item[transfer.dest] = transfer.item;
            }
        });
    }

    /**
     * The resolved real transfers (both ends real ports) as "source->dest", ordered by source —
     * mirrors the SQL portTransfer spec's ResolvedPortTransfer readout.
     * @returns {string}
     */
    resolvedEdges() {
        return this._resolved
            .filter(transfer => transfer.source !== EMPTY && transfer.dest !== EMPTY)
            .sort((a, b) => a.source - b.source)
            .map(transfer => `${transfer.source}->${transfer.dest}`)
            .join(", ");
    }
}
