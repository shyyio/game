import {World} from "@/common/sim/World.js";
import {rotate, chunkId} from "@/common/util.js";
import {LAYER_SURFACE} from "@/common/constants.js";
import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";
import {PlacedObjects} from "@/common/sim/PlacedObjects.js";

/**
 * @enum
 */
export const TickPhase = {

    /**
     * Submit port transfer intents
     */
    SUBMIT_INTENTS: 1,

    /**
     * (internal) Resolve the submitted transfer intents into this tick's moves
     */
    RESOLVE_TRANSFERS: 2,

    /**
     * Clear consumed source ports before the producers (belts) refill them in POST_RESOLVE.
     */
    CONSUME_INPUTS: 3,

    /**
     * Executed after transfer intents
     */
    POST_RESOLVE: 4,

    /**
     * Write resolved items into destination ports after the consumers ingested in POST_RESOLVE.
     */
    PRODUCE_OUTPUTS: 5,

    /**
     * (internal) Commit the resolved moves to the ports
     */
    COMMIT_TRANSFERS: 6,

    /**
     * (internal, engine-only) Diff/emit the out-port render events after mods have captured this
     * tick's watched port items in COMMIT_TRANSFERS. Mods register no ops here.
     */
    EMIT_RENDER: 7,

    /**
     * Mods snapshot inspected machines here; the engine drains them to sessions in postTick.
     */
    EMIT_INSPECT: 8,
}

// The tick phases run in order each whole tick.
export const TICK_PHASE_ORDER = [
    TickPhase.SUBMIT_INTENTS,
    TickPhase.RESOLVE_TRANSFERS,
    TickPhase.CONSUME_INPUTS,
    TickPhase.POST_RESOLVE,
    TickPhase.PRODUCE_OUTPUTS,
    TickPhase.COMMIT_TRANSFERS,
    TickPhase.EMIT_RENDER,
    TickPhase.EMIT_INSPECT,
];

// Port.item sentinel for an empty port
export const EMPTY = -1;

// Field sentinel for an eid-reference field with no target (a fresh port, an absent seam).
export const NO_EID = -1;

// Initial column length for every component store; grows by doubling when an eid exceeds it.
const PORT_CAPACITY = 1024;

// Column slot for a row a sparse component does not hold.
const NO_ROW = -1;

// Initial row count for the per-tick intent/resolved columns; grows by doubling.
const INTENT_CAPACITY = 1024;

// Intent flag bits.
const INTENT_DEST_EMPTY = 1;
const INTENT_MANAGED = 2;


/**
 * A registered component: its SoA Int32Array columns plus how they are indexed.
 *
 * A dense component's columns are indexed by eid and sized to the whole eid range — right for
 * components nearly every entity carries (Position, Port). A sparse one's are indexed by a row
 * number and sized to how many entities actually carry it, so a component held by a small slice of
 * the world costs a small slice of the memory. Rows come from the world's membership set, and a
 * removal swaps the last row down into the freed slot, so row numbers are stable only within a tick.
 */
class ComponentDef {

    /**
     * @param {string} name
     * @param {{name:string, kind:string, fill:number}[]} fields
     * @param {boolean} snapshotOnly
     * @param {boolean} sparse
     */
    constructor(
        name,
        fields,
        snapshotOnly,
        sparse,
    ) {
        this.name = name;
        this.fields = fields;
        this.snapshotOnly = snapshotOnly;
        this.sparse = sparse;
        this.capacity = PORT_CAPACITY;
        this.store = {};
        for (const field of fields) {
            this.store[field.name] = new Int32Array(PORT_CAPACITY).fill(field.fill);
        }

        /**
         * The world's membership set, adopted as row numbering; null for a dense component.
         * @type {?ComponentSet}
         */
        this.set = null;
    }

    /**
     * How many entities carry this component; sparse components only.
     * @returns {number}
     */
    get count() {
        return this.set.count;
    }

    /**
     * The eid of each live row, valid up to {@link count}; sparse components only.
     * @returns {Int32Array}
     */
    get eids() {
        return this.set.dense;
    }

    /**
     * The column row holding `eid`'s values, or NO_ROW when it does not carry this component;
     * sparse components only.
     * @param {number} eid
     * @returns {number}
     */
    row(eid) {
        return eid < this.set.sparse.length ? this.set.sparse[eid] : NO_ROW;
    }

    /**
     * The slot `eid`'s values live at: its row when sparse, the eid itself when dense.
     * @param {number} eid
     * @returns {number}
     */
    slot(eid) {
        return this.sparse ? this.row(eid) : eid;
    }

    /**
     * The entity whose values live at `slot`.
     * @param {number} slot
     * @returns {number}
     */
    eidAt(slot) {
        return this.sparse ? this.set.dense[slot] : slot;
    }
}


/**
 * The simulation engine Game drives: the port-transfer core over typed-array component
 * storage, the position/port indexes, (de)serialization, and the mod host — each loaded sim mod
 * registers its ECS content (components, systems, message handlers, chunk-sync contributors) via
 * {@link AbstractSimMod#setup}. Generic — it knows no specific content, so it imports nothing from
 * `mods/`.
 */
export class GameEngine {

    /**
     * @param {ModRegistry} [modRegistry] - mods whose setup registers content on init
     */
    constructor(modRegistry=null) {
        this.modRegistry = modRegistry;

        /**
         * The generic entity host for derived object types; built in init when a registry is given.
         * @type {PlacedObjects|null}
         */
        this.placed = null;

        // Provided service instances by their exported marker class (see provide/resolve).
        this._services = new Map();

        // Registered by mods.
        this._messageHandlers = [];
        this._chunkSyncers = [];
        this._inspectors = [];

        /**
         * @type {World|null}
         */
        this.world = null;

        // Registered components in definition order. The generic serializer walks these, so any state
        // kept here round-trips for free (see serialize).
        this._components = [];
        this._componentByName = new Map();

        // Port component: item type per port eid (EMPTY when unoccupied). An edge port also carries
        // Position for the edge it sits on, so _portsByEdge rebuilds from the world; a port with no
        // Position is not an edge port.
        this._portDef = this.defineComponent("Port", [
            {name: "item", fill: EMPTY},
        ]);
        this.Port = this._portDef.store;

        // Last emitted item per rendered port, so EMIT_RENDER emits only changes; EMPTY means nothing
        // drawn. Sized with the Port columns (see _growComponent).
        this._portShadow = new Int32Array(this._portDef.capacity).fill(EMPTY);
        // Out-ports whose resting item is drawn, and the tile it is drawn at. Modules register theirs;
        // re-registration is idempotent and a removed path's port can be unregistered (paths churn).
        this._rendered = new Uint8Array(this._portDef.capacity);
        this._renderX = new Int32Array(this._portDef.capacity);
        this._renderY = new Int32Array(this._portDef.capacity);
        // Ports written since the last render diff, and a per-eid flag so a port enters the list once.
        // EMIT_RENDER walks this instead of every rendered port in the world.
        this._dirtyPorts = [];
        this._portDirty = new Uint8Array(this._portDef.capacity);
        // Whether a rendered port's tile has a watcher, and the observation generation that answer was
        // computed at (0 = never). The render diff would otherwise hash the chunk and call through the
        // subscription predicate for every port written this tick.
        this._portObserved = new Uint8Array(this._portDef.capacity);
        this._portObservedGen = new Int32Array(this._portDef.capacity);

        // Per-port scratch for resolvePortTransfer, indexed by port eid and sized with the Port columns.
        // The resolver clears only the slots it touched, so no pass costs the width of the world.
        // Persist through the tick (mods query them in POST_RESOLVE):
        this._destBySource = new Int32Array(this._portDef.capacity).fill(EMPTY);
        this._portResolved = new Uint8Array(this._portDef.capacity);
        this._portResolvedUnmanaged = new Uint8Array(this._portDef.capacity);
        // Transient within resolvePortTransfer: the winning/best intent row per port, and whether the
        // port empties this tick.
        this._winnerByDest = new Int32Array(this._portDef.capacity).fill(EMPTY);
        this._bestBySource = new Int32Array(this._portDef.capacity).fill(EMPTY);
        this._draining = new Uint8Array(this._portDef.capacity);

        this._initIntentColumns();

        // Layer name <-> int code; the surface layer is code 0, mods register the rest (see
        // registerPositionLayer). Registration order is deterministic per loadout, so codes are stable
        // across save/load.
        this._layerCodes = new Map();
        this._layerNames = [];
        this.registerPositionLayer(LAYER_SURFACE);

        // Position component: where an entity sits. Carried by placed objects (their anchor tile), by
        // edge ports (the seam flow crosses), and by every occupied cell. `direction` is NO_EID for
        // things with no facing (cells).
        this._positionDef = this.defineComponent("Position", [
            {name: "x"},
            {name: "y"},
            {name: "direction", fill: NO_EID},
        ]);
        this.Position = this._positionDef.store;

        // Occupancy component: the cell claim on a Position, tagged with its owner object id (so a
        // delete releases all its cells by query) and per-cell userData read via occupantUserDataAt
        // (0 for plain footprints; e.g. resource cover stores its resource type). Objects on the same
        // layer collide; different layers coexist. Always paired with Position — cells are the entities
        // carrying both.
        this._occupancyDef = this.defineComponent("Occupancy", [
            {name: "layer"},
            {name: "owner", fill: NO_EID},
            {name: "userData"},
        ]);

        // Shared ports by edge key "x,y,direction" and occupied cells by "x,y,layer" — derived indexes
        // over the two components above, rebuilt from the world on deserialize.
        this._portsByEdge = new Map();
        this._cellByKey = new Map();

        // Global client-facing object id, shared across all object types so ids never collide.
        this._nextObjectId = 1;

        // Flat global counters that survive a save (mods stash their own here, e.g. beltNextRunId).
        this.globals = {};

        // Hooks returning the port eids a module still references in JS-only runtime state (belt paths),
        // so the port sweep keeps them alive — object ports are found by scanning component eid fields.
        this._portPins = [];
        // Hooks a module registers to rebuild its derived indexes after deserialize repopulates the world.
        this._rebuildHooks = [];
        // Hooks run at the start of serialize, letting a bespoke module (belts) flush JS-only runtime
        // state into its registered components so the generic reflection captures it.
        this._serializeHooks = [];

        // Per-phase system entries {order, seq, system}, kept sorted and run in order by tick(phase).
        this._systemSeq = 0;
        this.systems = {};
        for (const phase of TICK_PHASE_ORDER) {
            this.systems[phase] = [];
        }
        this.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._resetTick());
        this.registerSystem(TickPhase.RESOLVE_TRANSFERS, () => this.resolvePortTransfer());
        this.registerSystem(TickPhase.CONSUME_INPUTS, () => this.flushSinks());
        this.registerSystem(TickPhase.COMMIT_TRANSFERS, () => this.commitTransfers());
        this.registerSystem(TickPhase.EMIT_RENDER, () => this._emitRender());

        // Ports unregistered while holding a rendered item (eid -> {x, y}): a pending clear, cancelled if
        // the port is re-registered in the same edit (so a churned-but-surviving port stays static, no
        // clear+set glide). Flushed by the render diff.
        this._pendingClear = new Map();
        // Sink for domain events (placement/path/delete + port-item render deltas). Game broadcasts each
        // synchronously by chunk; tests install an EventCollector. Null until one is installed.
        this._eventSink = null;
        // Whether any session is watching a chunk. Emitters skip building an event nobody receives; a
        // session that subscribes later gets the state through chunkSync, not the missed deltas.
        this._chunkObserved = () => false;
        // Bumped whenever the answer `_chunkObserved` gives could have changed, so a system caching
        // "is this thing watched" per entity can revalidate on an integer compare instead of asking
        // again every tick. Starts at 1, leaving 0 as "never computed" for those caches.
        this._observerGeneration = 1;

        this._resetTick();
    }

    /**
     * Passes a domain event to the event sink.
     * @param {AbstractTilePositionedEvent} event
     * @returns {void}
     */
    emitEvent(event) {
        if (this._eventSink !== null) {
            this._eventSink(event);
        }
    }

    /**
     * Sets the sink each emitted event is delivered to, and optionally the predicate deciding whether
     * a chunk has any watcher; without one every chunk counts as observed.
     * @param {function(AbstractTilePositionedEvent): void} sink
     * @param {function(number): boolean} [chunkObserved]
     * @returns {void}
     */
    setEventSink(sink, chunkObserved) {
        this._eventSink = sink;
        this._chunkObserved = chunkObserved === undefined ? () => true : chunkObserved;
        this.invalidateObservers();
    }

    /**
     * Marks every cached observation stale. The owner of the subscriptions calls this whenever a
     * session's viewport changes, so the sim's per-entity caches recompute on their next check.
     * @returns {void}
     */
    invalidateObservers() {
        this._observerGeneration += 1;
    }

    /**
     * @returns {number} the current observation generation; a cache stamped with it is still valid
     */
    get observerGeneration() {
        return this._observerGeneration;
    }

    /**
     * Whether an event about tile (x, y) would reach anyone. Emitters check this before building one.
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    observesTile(x, y) {
        return this._chunkObserved(chunkId(x, y));
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
        this._rendered[eid] = 1;
        this._portObservedGen[eid] = 0;
        this._renderX[eid] = x;
        this._renderY[eid] = y;
        // A re-registered port survives the edit: cancel any pending clear so its sprite stays put
        // (item unchanged -> the diff emits nothing) instead of a clear+set that glides in a new sprite.
        this._pendingClear.delete(eid);
        this._markPortDirty(eid);
    }

    /**
     * The tile a rendered port's resting item is drawn at, or null if the port is not rendered.
     * @param {number} eid
     * @returns {{x:number, y:number}|null}
     */
    renderedPortTile(eid) {
        if (this._rendered[eid] === 0) {
            return null;
        }
        return {x: this._renderX[eid], y: this._renderY[eid]};
    }

    /**
     * Queues a port for the next render diff. The diff walks only these, so every write to Port.item
     * must come through here (see setPortItem).
     * @private
     * @param {number} eid
     * @returns {void}
     */
    _markPortDirty(eid) {
        if (this._portDirty[eid] === 1) {
            return;
        }
        this._portDirty[eid] = 1;
        this._dirtyPorts.push(eid);
    }

    /**
     * Stops drawing a port (its path was removed). If it held a rendered item, the clear is deferred to
     * the next render diff so a same-edit re-registration can cancel it (keeping a surviving port static).
     * @param {number} eid
     * @returns {void}
     */
    unregisterRenderedPort(eid) {
        if (this._portShadow[eid] !== EMPTY && this._rendered[eid] === 1) {
            this._pendingClear.set(eid, {x: this._renderX[eid], y: this._renderY[eid]});
        }
        this._rendered[eid] = 0;
    }

    /**
     * Whether the port's render tile has a watcher, cached until the observation generation moves.
     * @private
     * @param {number} eid
     * @returns {boolean}
     */
    _portObservedAt(eid) {
        const generation = this._observerGeneration;
        if (this._portObservedGen[eid] === generation) {
            return this._portObserved[eid] === 1;
        }
        const observed = this._chunkObserved(chunkId(this._renderX[eid], this._renderY[eid]));
        this._portObservedGen[eid] = generation;
        this._portObserved[eid] = observed ? 1 : 0;
        return observed;
    }

    /**
     * EMIT_RENDER: flush deferred clears (ports unregistered for good), then diff each port written
     * since the last render against the shadow, buffering a set (item appeared or changed) or clear
     * (item left) event.
     * @private
     * @returns {void}
     */
    _emitRender() {
        for (const [eid, position] of this._pendingClear) {
            this.emitEvent(new PortItemClearEvent(position.x, position.y, eid));
            this._portShadow[eid] = EMPTY;
        }
        this._pendingClear.clear();

        const item = this.Port.item;
        for (const eid of this._dirtyPorts) {
            this._portDirty[eid] = 0;
            if (this._rendered[eid] === 0 || item[eid] === this._portShadow[eid]) {
                continue;
            }
            this._portShadow[eid] = item[eid];
            if (!this._portObservedAt(eid)) {
                continue;
            }
            const x = this._renderX[eid];
            const y = this._renderY[eid];
            if (item[eid] === EMPTY) {
                this.emitEvent(new PortItemClearEvent(x, y, eid));
            } else {
                this.emitEvent(new PortItemSetEvent(x, y, eid, item[eid]));
            }
        }
        this._dirtyPorts.length = 0;
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
        this.world = new World();
        for (const def of this._components) {
            this._bindComponent(def);
        }
        if (this.modRegistry !== null) {
            // The registry must be frozen (typeIds assigned) before content wires up; the accessors
            // throw otherwise. The generic entity host installs every derived type's behavior first,
            // then bespoke sim mods register theirs.
            this.placed = new PlacedObjects(this, this.modRegistry);
            for (const mod of this.modRegistry.simMods) {
                mod.setup(this);
            }
        }
    }

    /**
     * @param {TickPhase} phase
     * @returns {void}
     */
    tick(phase) {
        for (const entry of this.systems[phase]) {
            entry.system();
        }
    }

    /**
     * Runs a whole tick (every phase in order).
     * @returns {void}
     */
    tickAll() {
        for (const phase of TICK_PHASE_ORDER) {
            this.tick(phase);
        }
    }

    /**
     * Registers a system on a phase. Systems run by ascending `order`, ties by registration order;
     * a negative order runs before the phase's default-order systems (e.g. a seam that must read
     * shared ports before the transport writes them).
     * @param {TickPhase} phase
     * @param {function(): void} system
     * @param {number} [order]
     * @returns {void}
     */
    registerSystem(phase, system, order=0) {
        const entries = this.systems[phase];
        entries.push({order, seq: this._systemSeq, system});
        this._systemSeq += 1;
        entries.sort((a, b) => a.order - b.order || a.seq - b.seq);
    }

    /**
     * The destination a resolved transfer moved this source's item to this tick, or EMPTY. Lets a mod
     * doing its own (managed=0) move read the engine's resolution.
     * @param {number} source
     * @returns {number}
     */
    resolvedDestFor(source) {
        return this._destBySource[source];
    }

    /**
     * Whether a transfer resolved into this destination this tick. Lets a producer detect its output
     * was delivered (its create intent is source-less, so resolvedDestFor can't key on it).
     * @param {number} dest
     * @returns {boolean}
     */
    wasResolvedDest(dest) {
        return dest !== EMPTY && this._portResolved[dest] === 1;
    }

    /**
     * As {@link wasResolvedDest} but only for unmanaged (managed=0) transfers — the form belts submit,
     * where a resolved out-port means the path may pop this tick.
     * @param {number} dest
     * @returns {boolean}
     */
    resolvedUnmanagedDest(dest) {
        return dest !== EMPTY && this._portResolvedUnmanaged[dest] === 1;
    }

    /**
     * Clears this tick's transient transfer buffers.
     * @private
     * @returns {void}
     */
    _resetTick() {
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
     * Allocates the per-tick intent and resolved-transfer columns. Both are SoA: one row per submitted
     * intent / committed transfer, so a tick's several hundred thousand rows cost no object headers.
     * @private
     * @returns {void}
     */
    _initIntentColumns() {
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

        // resolvePortTransfer's working lists, reused tick to tick. Every one of them holds at most one
        // entry per intent row, so a single grow against the intent count sizes them all.
        this._scratchCapacity = INTENT_CAPACITY;
        this._touchedDests = new Int32Array(INTENT_CAPACITY);
        this._touchedSources = new Int32Array(INTENT_CAPACITY);
        this._drainQueue = new Int32Array(INTENT_CAPACITY);
        this._resolvedRows = new Int32Array(INTENT_CAPACITY);
        this._rankedSources = new Int32Array(INTENT_CAPACITY);
        // Managed destination-less sources the engine drains this tick.
        this._sinks = new Int32Array(INTENT_CAPACITY);
        this._sinkCount = 0;
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

    /**
     * Registers a component store: SoA Int32Array columns grown by doubling, tracked for generic
     * serialization. `fields` are {name, kind?, fill?} — kind "eid" marks an entity-reference column
     * remapped on deserialize (default "i32"); fill is the empty-slot value (default 0). Modules call
     * this so their state round-trips with no bespoke save code.
     * @param {string} name
     * @param {{name:string, kind?:string, fill?:number}[]} fieldSpecs
     * @param {{snapshotOnly?:boolean, sparse?:boolean}} [options] - snapshotOnly components hold state
     *     materialized at save (belt paths), not kept in sync during play, so the port sweep ignores
     *     their eid fields (the module's live pin hook is authoritative instead); sparse components
     *     index their columns by row instead of by eid, so a component only a slice of the world
     *     carries is sized to that slice (see {@link ComponentDef})
     * @returns {ComponentDef}
     */
    defineComponent(name, fieldSpecs, {snapshotOnly=false, sparse=false}={}) {
        const fields = fieldSpecs.map(spec => ({
            name: spec.name,
            kind: spec.kind === undefined ? "i32" : spec.kind,
            fill: spec.fill === undefined ? 0 : spec.fill,
        }));
        const def = new ComponentDef(name, fields, snapshotOnly, sparse);
        this._components.push(def);
        this._componentByName.set(name, def);
        if (this.world !== null) {
            this._bindComponent(def);
        }
        return def;
    }

    /**
     * Adopts the world's membership set as a sparse component's row numbering. Called for every
     * component whenever a world is created, since the components outlive it.
     * @private
     * @param {ComponentDef} def
     * @returns {void}
     */
    _bindComponent(def) {
        if (!def.sparse) {
            return;
        }
        def.set = this.world.trackRows(def.store, (fromRow, toRow) => {
            for (const field of def.fields) {
                const column = def.store[field.name];
                column[toRow] = column[fromRow];
            }
        });
    }

    /**
     * Grows a component's columns so `slot` is addressable.
     * @private
     * @param {ComponentDef} def
     * @param {number} slot - an eid when dense, a row when sparse
     * @returns {void}
     */
    _growComponent(def, slot) {
        if (slot < def.capacity) {
            return;
        }
        let capacity = def.capacity;
        while (capacity <= slot) {
            capacity *= 2;
        }
        for (const field of def.fields) {
            const grown = new Int32Array(capacity).fill(field.fill);
            grown.set(def.store[field.name]);
            def.store[field.name] = grown;
        }
        def.capacity = capacity;
        if (def === this._portDef) {
            this.Port = def.store;
            for (const name of ["_renderX", "_renderY", "_portObservedGen"]) {
                const grown = new Int32Array(capacity);
                grown.set(this[name]);
                this[name] = grown;
            }
            for (const name of ["_portShadow", "_destBySource", "_winnerByDest", "_bestBySource"]) {
                const grown = new Int32Array(capacity).fill(EMPTY);
                grown.set(this[name]);
                this[name] = grown;
            }
            for (const name of ["_portDirty", "_rendered", "_portObserved", "_portResolved", "_portResolvedUnmanaged", "_draining"]) {
                const grown = new Uint8Array(capacity);
                grown.set(this[name]);
                this[name] = grown;
            }
        }
        if (def === this._positionDef) {
            this.Position = def.store;
        }
    }

    /**
     * Attaches a component to `eid`, growing its columns first. A sparse component's new row is
     * cleared, since a prior tenant's values may still sit there.
     * @private
     * @param {ComponentDef} def
     * @param {number} eid
     * @returns {void}
     */
    _addComponent(def, eid) {
        if (!def.sparse) {
            this._growComponent(def, eid);
            this.world.addComponent(eid, def.store);
            return;
        }
        this.world.addComponent(eid, def.store);
        const row = def.row(eid);
        this._growComponent(def, row);
        for (const field of def.fields) {
            def.store[field.name][row] = field.fill;
        }
    }

    /**
     * Attaches a component to an existing entity (a behavior wiring its columns onto a placed eid).
     * @param {object} def - a descriptor from {@link defineComponent}
     * @param {number} eid
     * @returns {void}
     */
    attachComponent(def, eid) {
        this._addComponent(def, eid);
    }

    /**
     * The component descriptor registered under `name`; throws on an unknown name.
     * @param {string} name
     * @returns {{name:string, fields:object[], store:object, capacity:number}}
     */
    component(name) {
        const def = this._componentByName.get(name);
        if (def === undefined) {
            throw new Error(`Unknown component "${name}"`);
        }
        return def;
    }

    /**
     * Creates a port carrying `item` (EMPTY for an empty port).
     * @param {number} [item]
     * @returns {number} the port eid
     */
    createPort(item=EMPTY) {
        const eid = this.world.addEntity();
        this._addComponent(this._portDef, eid);
        // bitECS recycles eids, so clear any shadow the previous tenant left behind.
        this._portShadow[eid] = EMPTY;
        this.setPortItem(eid, item);
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
            eid = this.createPort();
            this.setPosition(eid, x, y, direction);
            this._portsByEdge.set(key, eid);
        }
        return eid;
    }

    /**
     * Places `eid` at (x, y) facing `direction`, attaching Position if it has none.
     * @param {number} eid
     * @param {number} x
     * @param {number} y
     * @param {number} [direction] - NO_EID for something with no facing
     * @returns {void}
     */
    setPosition(eid, x, y, direction=NO_EID) {
        this._addComponent(this._positionDef, eid);
        this.Position.x[eid] = x;
        this.Position.y[eid] = y;
        this.Position.direction[eid] = direction;
    }

    /**
     * Registers a position layer name, returning its stable int code (idempotent).
     * @param {string} name
     * @returns {number}
     */
    registerPositionLayer(name) {
        let code = this._layerCodes.get(name);
        if (code === undefined) {
            code = this._layerNames.length;
            this._layerCodes.set(name, code);
            this._layerNames.push(name);
        }
        return code;
    }

    /**
     * Whether every cell {x, y, layer} is free.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @returns {boolean}
     */
    cellsFree(cells) {
        return cells.every(cell => !this._cellByKey.has(`${cell.x},${cell.y},${cell.layer}`));
    }

    /**
     * The userData stored at cell {x, y, layer}, or null when the cell is free.
     * @param {number} x
     * @param {number} y
     * @param {string} layer
     * @returns {number|null}
     */
    occupantUserDataAt(x, y, layer) {
        const eid = this._cellByKey.get(`${x},${y},${layer}`);
        return eid === undefined ? null : this._occupancyDef.store.userData[eid];
    }

    /**
     * Marks each cell occupied, one Position+Occupancy entity per newly taken cell, tagged with `owner`
     * so {@link destroyOwnerCells} can destroy them all on delete.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @param {number} [owner] - the owning object id
     * @param {number} [userData] - per-cell value read back via {@link occupantUserDataAt}
     * @returns {void}
     */
    occupy(cells, owner=NO_EID, userData=0) {
        const occupancy = this._occupancyDef.store;
        for (const cell of cells) {
            const key = `${cell.x},${cell.y},${cell.layer}`;
            if (this._cellByKey.has(key)) {
                continue;
            }
            const eid = this.world.addEntity();
            this.setPosition(eid, cell.x, cell.y);
            this._addComponent(this._occupancyDef, eid);
            occupancy.layer[eid] = this._layerCodes.get(cell.layer);
            occupancy.owner[eid] = owner;
            occupancy.userData[eid] = userData;
            this._cellByKey.set(key, eid);
        }
    }

    /**
     * Destroys each cell.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @returns {void}
     */
    destroyCells(cells) {
        for (const cell of cells) {
            const key = `${cell.x},${cell.y},${cell.layer}`;
            const eid = this._cellByKey.get(key);
            if (eid !== undefined) {
                this.world.removeEntity(eid);
                this._cellByKey.delete(key);
            }
        }
    }

    /**
     * Destroys every cell an object occupied, keyed by the owner id passed to {@link occupy}.
     * @param {number} owner
     * @returns {void}
     */
    destroyOwnerCells(owner) {
        const occupancy = this._occupancyDef.store;
        for (const eid of this._cellEids()) {
            if (occupancy.owner[eid] === owner) {
                this._cellByKey.delete(this._cellKey(eid));
                this.world.removeEntity(eid);
            }
        }
    }

    /**
     * The cell entities: those carrying both Position and Occupancy (an edge port has Position alone).
     * @private
     * @returns {number[]}
     */
    _cellEids() {
        return this.world.query([this._positionDef.store, this._occupancyDef.store]);
    }

    /**
     * @private
     * @param {number} eid - a cell entity
     * @returns {string} its "x,y,layer" index key
     */
    _cellKey(eid) {
        const layer = this._layerNames[this._occupancyDef.store.layer[eid]];
        return `${this.Position.x[eid]},${this.Position.y[eid]},${layer}`;
    }

    /**
     * A module registers a hook returning the port eids its JS-only runtime state still references
     * (belt paths hold their end ports outside any component), so {@link collectUnreferencedPorts}
     * keeps them.
     * @param {function(): Iterable<number>} hook
     * @returns {void}
     */
    registerPortPin(hook) {
        this._portPins.push(hook);
    }

    /**
     * Destroys every port no live entity or module references: scans all component eid fields (object
     * ports) plus the pin hooks (belt runtime ports), then removes any port outside that set — destroying
     * the edges a deleted object or belt left behind.
     * @returns {void}
     */
    collectUnreferencedPorts() {
        const referenced = new Set();
        for (const def of this._components) {
            if (def.snapshotOnly) {
                continue;
            }
            const eidFields = def.fields.filter(field => field.kind === "eid");
            if (eidFields.length === 0) {
                continue;
            }
            for (const slot of this._slotsOf(def)) {
                for (const field of eidFields) {
                    const target = def.store[field.name][slot];
                    if (target !== NO_EID) {
                        referenced.add(target);
                    }
                }
            }
        }
        for (const hook of this._portPins) {
            for (const eid of hook()) {
                referenced.add(eid);
            }
        }

        for (const eid of this.world.query([this._portDef.store])) {
            if (referenced.has(eid)) {
                continue;
            }
            if (this.world.hasComponent(eid, this._positionDef.store)) {
                this._portsByEdge.delete(this._edgeKey(eid));
            }
            this._rendered[eid] = 0;
            this._portShadow[eid] = EMPTY;
            this._pendingClear.delete(eid);
            this.world.removeEntity(eid);
        }
    }

    /**
     * Creates an entity carrying `def`'s component.
     * @param {object} def - a descriptor from {@link defineComponent}
     * @returns {number} the entity id
     */
    createEntity(def) {
        const eid = this.world.addEntity();
        this._addComponent(def, eid);
        return eid;
    }

    /**
     * Removes an entity (and all its components) from the world; a no-op for an already-destroyed eid.
     * @param {number} eid
     * @returns {void}
     */
    destroyEntity(eid) {
        if (this.world.entityExists(eid)) {
            this.world.removeEntity(eid);
        }
    }

    /**
     * The entities currently carrying `def`'s component.
     * @param {object} def - a descriptor from {@link defineComponent}
     * @returns {number[]}
     */
    entitiesWith(def) {
        return def.sparse ? def.eids.slice(0, def.count) : this.world.query([def.store]);
    }

    /**
     * Every live slot of `def`'s columns: its rows when sparse, its entity ids when dense. Lets the
     * generic passes (the port sweep, serialize) read any component without knowing which it is.
     * @private
     * @param {ComponentDef} def
     * @returns {Int32Array}
     */
    _slotsOf(def) {
        if (!def.sparse) {
            return this.world.query([def.store]);
        }
        const slots = new Int32Array(def.count);
        for (let row = 0; row < def.count; row += 1) {
            slots[row] = row;
        }
        return slots;
    }

    /**
     * Creates the next global client-facing object id.
     * @returns {number}
     */
    createObjectId() {
        const id = this._nextObjectId;
        this._nextObjectId += 1;
        return id;
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
        this._markPortDirty(eid);
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
        this._intentFlags[row] = (destEmpty ? INTENT_DEST_EMPTY : 0) | (managed ? INTENT_MANAGED : 0);
        this._intentSeen[row] = 0;
        this._intentCount = row + 1;
    }

    /**
     * Resolves this tick's intents into resolved transfers via a linear backward propagation over the
     * functional transfer graph.
     * @returns {void}
     */
    resolvePortTransfer() {
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
        const sourceItem = source === EMPTY ? EMPTY : this.Port.item[source];
        const item = managed ? (outputItem !== EMPTY ? outputItem : sourceItem) : EMPTY;

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
            const source = this._sinks[index];
            this.Port.item[source] = EMPTY;
            this._markPortDirty(source);
        }
    }

    /**
     * COMMIT_TRANSFERS: applies resolved managed transfers to Port — clears sources, then writes
     * destinations, so a packed chain shifts atomically.
     * @returns {void}
     */
    commitTransfers() {
        for (let row = 0; row < this._resolvedCount; row += 1) {
            const source = this._resolvedSource[row];
            if (this._resolvedManaged[row] === 1 && source !== EMPTY) {
                this.Port.item[source] = EMPTY;
                this._markPortDirty(source);
            }
        }
        for (let row = 0; row < this._resolvedCount; row += 1) {
            const dest = this._resolvedDest[row];
            if (this._resolvedManaged[row] === 1 && dest !== EMPTY) {
                this.Port.item[dest] = this._resolvedItem[row];
                this._markPortDirty(dest);
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
     * A module registers a hook run after {@link deserialize} repopulates the world, to rebuild its own
     * derived indexes from the restored components. Receives the old-eid -> new-eid remap.
     * @param {function(Map<number,number>): void} hook
     * @returns {void}
     */
    registerRebuildHook(hook) {
        this._rebuildHooks.push(hook);
    }

    /**
     * A bespoke module registers a hook run at the start of {@link serialize}, to materialize any
     * JS-only runtime state into its registered components before reflection reads them.
     * @param {function(): void} hook
     * @returns {void}
     */
    registerSerializeHook(hook) {
        this._serializeHooks.push(hook);
    }

    /**
     * A serializable snapshot of the whole world: every registered component as a table of rows (one
     * per entity holding it), plus the global counters. Reflection over the component registry, so a
     * module storing its state in components round-trips with no bespoke save code.
     * @returns {{components:object[], globals:object}}
     */
    serialize() {
        for (const hook of this._serializeHooks) {
            hook();
        }
        const components = this._components.map(def => {
            const rows = [];
            for (const slot of this._slotsOf(def)) {
                const row = {eid: def.eidAt(slot)};
                for (const field of def.fields) {
                    row[field.name] = def.store[field.name][slot];
                }
                rows.push(row);
            }
            // A sparse component's rows shuffle as entities come and go, so order them here: the same
            // world then serializes to the same bytes however it was built.
            rows.sort((a, b) => a.eid - b.eid);
            return {
                name: def.name,
                fields: def.fields.map(field => ({name: field.name, kind: field.kind})),
                rows: rows,
            };
        });
        // Component values are Int32Array-backed, so always safe; only the unbounded globals (id
        // counters) can overflow past 2^53, where Number silently loses precision.
        const globals = {nextObjectId: this._nextObjectId, ...this.globals};
        for (const key of Object.keys(globals)) {
            if (!Number.isSafeInteger(globals[key])) {
                throw new RangeError(`GameEngine.serialize: global "${key}" is not a safe integer: ${globals[key]}`);
            }
        }
        return {components: components, globals: globals};
    }

    /**
     * Rebuilds the world from a {@link serialize} snapshot: fresh entities for every saved eid (eid
     * columns remapped so references stay consistent), then the engine's derived indexes and each
     * module's via its rebuild hook.
     * @param {{components:object[], globals:object}} snapshot
     * @returns {void}
     */
    deserialize(snapshot) {
        this.world = new World();
        for (const def of this._components) {
            this._bindComponent(def);
        }
        for (const def of this._components) {
            for (const field of def.fields) {
                def.store[field.name].fill(field.fill);
            }
        }
        this._portsByEdge = new Map();
        this._cellByKey = new Map();
        // Drop the prior world's render/tick state so its stale eids never leak into the new world.
        this._rendered.fill(0);
        this._portShadow.fill(EMPTY);
        this._portDirty.fill(0);
        this._dirtyPorts.length = 0;
        this._pendingClear = new Map();
        this._resetTick();

        // Every eid that appears (as a row's own eid or an eid-field target) needs a fresh entity.
        const referenced = new Set();
        for (const component of snapshot.components) {
            for (const row of component.rows) {
                referenced.add(row.eid);
                for (const field of component.fields) {
                    if (field.kind === "eid" && row[field.name] !== NO_EID) {
                        referenced.add(row[field.name]);
                    }
                }
            }
        }
        const remap = new Map();
        for (const old of [...referenced].sort((a, b) => a - b)) {
            remap.set(old, this.world.addEntity());
        }
        const translate = value => (value === NO_EID ? NO_EID : remap.get(value));

        for (const component of snapshot.components) {
            const def = this._componentByName.get(component.name);
            for (const row of component.rows) {
                const eid = remap.get(row.eid);
                this._addComponent(def, eid);
                const slot = def.slot(eid);
                for (const field of def.fields) {
                    const raw = row[field.name];
                    def.store[field.name][slot] = field.kind === "eid" ? translate(raw) : raw;
                }
            }
        }

        this._nextObjectId = snapshot.globals.nextObjectId;
        for (const key of Object.keys(snapshot.globals)) {
            if (key !== "nextObjectId") {
                this.globals[key] = snapshot.globals[key];
            }
        }

        this._rebuildPortEdges();
        this._rebuildPositions();
        for (const hook of this._rebuildHooks) {
            hook(remap);
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuildPortEdges() {
        for (const eid of this._edgePortEids()) {
            this._portsByEdge.set(this._edgeKey(eid), eid);
        }
    }

    /**
     * The edge ports: those carrying Position (a port with none sits on no edge).
     * @private
     * @returns {number[]}
     */
    _edgePortEids() {
        return this.world.query([this._portDef.store, this._positionDef.store]);
    }

    /**
     * @private
     * @param {number} eid - an edge port
     * @returns {string} its "x,y,direction" index key
     */
    _edgeKey(eid) {
        return `${this.Position.x[eid]},${this.Position.y[eid]},${this.Position.direction[eid]}`;
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuildPositions() {
        for (const eid of this._cellEids()) {
            this._cellByKey.set(this._cellKey(eid), eid);
        }
    }

    /**
     * A mod registers a message handler (returns true if it handled the message).
     * @param {function(AbstractMessage): boolean} handler
     * @returns {void}
     */
    registerMessageHandler(handler) {
        this._messageHandlers.push(handler);
    }

    /**
     * A mod registers a chunk-sync contributor (chunk -> events).
     * @param {function(number): object[]} contributor
     * @returns {void}
     */
    registerChunkSync(contributor) {
        this._chunkSyncers.push(contributor);
    }

    /**
     * A mod registers an inspect snapshotter (object client id -> InspectHeartbeatEvent or null).
     * @param {function(number): (object|null)} inspector
     * @returns {void}
     */
    registerInspector(inspector) {
        this._inspectors.push(inspector);
    }

    /**
     * Provides a service instance under its exported marker class, for cross-mod + test access.
     * @param {Function} key - the service's marker class
     * @param {object} instance
     * @returns {object} the instance
     */
    provide(key, instance) {
        if (this._services.has(key)) {
            throw new Error(`Service "${key.name}" already provided`);
        }
        this._services.set(key, instance);
        return instance;
    }

    /**
     * The service provided under `key`; throws when no provider registered it.
     * @param {Function} key - the service's marker class
     * @returns {object}
     */
    resolve(key) {
        const instance = this._services.get(key);
        if (instance === undefined) {
            throw new Error(`No provider for service "${key.name}"`);
        }
        return instance;
    }

    /**
     * The current inspect snapshot for an object, or null if no module owns that client id.
     * @param {number} objectId
     * @returns {object|null}
     */
    inspectSnapshot(objectId) {
        for (let i = 0; i < this._inspectors.length; i += 1) {
            const snapshot = this._inspectors[i](objectId);
            if (snapshot !== null) {
                return snapshot;
            }
        }
        return null;
    }

    /**
     * @param {AbstractMessage} message
     * @returns {boolean}
     */
    applyMessage(message) {
        if (message instanceof DeleteObjectMessage) {
            this.untrack(message.id);
            const handled = this._messageHandlers.some(handler => handler(message));
            // A delete (and any belt relink it triggered) can strand ports; destroy them now.
            this.collectUnreferencedPorts();
            return handled;
        }
        return this._messageHandlers.some(handler => handler(message));
    }

    /**
     * @param {number} chunk
     * @returns {object[]}
     */
    chunkSync(chunk) {
        const events = [];
        for (const contributor of this._chunkSyncers) {
            for (const event of contributor(chunk)) {
                events.push(event);
            }
        }
        return events;
    }

    /**
     * Resolves the shared edge port for a definition's PortDefinition on an object placed at (x, y)
     * facing `direction` — offset and local direction rotated by the placement.
     * @param {PortDefinition} portVec
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {{port:number, tile:{x:number, y:number}}}
     */
    portFor(portVec, x, y, direction) {
        const r = rotate(portVec, direction);
        const tile = {x: x + r.x, y: y + r.y};
        return {port: this.portAt(tile.x, tile.y, r.direction), tile};
    }

    /**
     * The surface cells a definition occupies at (x, y) facing `direction`.
     * @param {ObjectType} definition
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {{x:number, y:number, layer:string}[]}
     */
    footprint(definition, x, y, direction) {
        return definition.geometry.tiles(direction).map(cell => ({x: x + cell.x, y: y + cell.y, layer: LAYER_SURFACE}));
    }

    /**
     * Occupies a placed object's footprint, tagged with its client id so a delete destroys it.
     * @param {number} objectId
     * @param {{x:number, y:number, layer:string}[]} footprint
     * @returns {void}
     */
    track(objectId, footprint) {
        this.occupy(footprint, objectId);
    }

    /**
     * Destroys a deleted object's footprint.
     * @param {number} objectId
     * @returns {void}
     */
    untrack(objectId) {
        this.destroyOwnerCells(objectId);
    }
}
