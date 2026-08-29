import {World} from "@/sim/World.js";
import {rotate, chunkId, tileId, tileVariantId} from "@/common/util.js";
import {GAME_VERSION, PLAYER_ID_NONE} from "@/common/constants.js";
import {SAVE_FORMAT} from "@/common/saveMigrations.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {PlacedObjects} from "@/sim/PlacedObjects.js";
import {OverworldBake} from "@/sim/OverworldBake.js";
import {WorkerNetworks} from "@/sim/WorkerNetworks.js";
import {ComponentRegistry} from "@/sim/ComponentRegistry.js";
import {SpatialIndex} from "@/sim/SpatialIndex.js";
import {TransferResolver} from "@/sim/TransferResolver.js";
import {RenderDiff} from "@/sim/RenderDiff.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";

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

/**
 * An Int32Array column indexed by port eid, owned by a module but grown by the engine with the Port
 * component. The engine replaces {@link column} on growth, so a caller reads it fresh each pass
 * (hoisting it for the body of one loop is fine).
 */
class PortColumn {

    /**
     * @param {number} capacity
     * @param {number} fill - the value an unwritten port reads as
     */
    constructor(capacity, fill) {
        this.fill = fill;
        this.column = new Int32Array(capacity).fill(fill);
    }

    /**
     * @param {number} capacity
     * @returns {void}
     */
    grow(capacity) {
        const grown = new Int32Array(capacity).fill(this.fill);
        grown.set(this.column);
        this.column = grown;
    }

    /**
     * Resets every port to the column's fill.
     * @returns {void}
     */
    clear() {
        this.column.fill(this.fill);
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
        this._initHostSlots();

        /**
         * Every component the loadout registers, and the entity operations over them.
         * @type {ComponentRegistry}
         */
        this.components = new ComponentRegistry(this);
        this._initPortState();
        this._initSpatialState();
        this._initSaveState();
        this._registerCoreSystems();
        this._initRenderSinks();

        this.transfers.resetTick();
    }

    /**
     * Nulls the collaborators, service map, and mod-registered hook lists that init fills in.
     * @private
     * @returns {void}
     */
    _initHostSlots() {
        /**
         * The generic entity host for derived object types; built in init when a registry is given.
         * @type {PlacedObjects|null}
         */
        this.placed = null;

        /**
         * The hot-read overworld tile bake over the placed objects; built with the entity host.
         * @type {OverworldBake|null}
         */
        this.overworldBake = null;

        /**
         * Road-network worker allocation over the placed objects; built with the entity host.
         * @type {WorkerNetworks|null}
         */
        this.workers = null;

        // Provided service instances by their exported marker class (see provide/resolve).
        this._services = new Map();

        // Fluid payload numbers (drawn as fill levels, never as item sprites); filled from the
        // registry at init.
        this._fluidTypes = new Set();

        // Registered by mods.
        this._messageHandlers = [];
        this._chunkSyncers = [];
        this._inspectors = [];
        this._placementGuards = [];
        this._despawnListeners = [];

        // Decides whether a player may modify a chunk; without one every change is allowed.
        this._placementGate = null;

        // Resolves a chunk's current owner for the placed-object owner cache; null in tests without a Game.
        this._chunkOwnerResolver = null;

        /**
         * @type {World|null}
         */
        this.world = null;
    }

    /**
     * Defines the Port component and every column indexed by port eid.
     * @private
     * @returns {void}
     */
    _initPortState() {
        // Port component: item type per port eid (EMPTY when unoccupied). An edge port also carries
        // Position for the edge it sits on, so _portsByEdge rebuilds from the world; a port with no
        // Position is not an edge port.
        this._portDef = this.components.define("Port", [
            {name: "item", fill: EMPTY},
        ]);
        this.Port = this._portDef.store;

        // Ports belonging to fluid machinery (pipe network and tank edges); belts refuse to link
        // with one. Marked by the owning module, re-marked on rebuild.
        this._portFluid = new Uint8Array(this._portDef.capacity);
        // The fluid type a producer emits into a port (EMPTY for none/solid), so a pipe network
        // adopting the edge binds its type before the first payload. The generation bumps on every
        // write, so an idle consumer re-scans its sources only when one could have changed.
        this._portFluidSource = new Int32Array(this._portDef.capacity).fill(EMPTY);
        this._fluidSourceGeneration = 1;

        /**
         * What the client is told about resting port items.
         * @type {RenderDiff}
         */
        this.render = new RenderDiff(this, this._portDef.capacity);

        // Module-owned columns indexed by port eid; grown with the Port component (see _growPortColumns).
        this._portColumns = [];

        /**
         * The port-transfer protocol: submitted intents, this tick's resolutions, and the commit.
         * @type {TransferResolver}
         */
        this.transfers = new TransferResolver(this, this._portDef.capacity);

        this.components.onGrow(this._portDef, capacity => this._growPortColumns(capacity));
    }

    /**
     * Builds the spatial index (positions, layers, occupied cells) and the port edge index over it.
     * @private
     * @returns {void}
     */
    _initSpatialState() {
        /**
         * Where things sit: the Position/Occupancy components and the cell index over them.
         * @type {SpatialIndex}
         */
        this.space = new SpatialIndex(this);
        this.Position = this.space.Position;

        // Shared ports by edge key "x,y,direction" — a derived index over Port + Position, rebuilt
        // from the world on deserialize.
        this._portsByEdge = new Map();
    }

    /**
     * Initializes the persisted globals and the hooks serialize and deserialize run through.
     * @private
     * @returns {void}
     */
    _initSaveState() {
        // Global client-facing object id, shared across all object types so ids never collide.
        this._nextObjectId = 1;

        // Whole ticks elapsed, incremented once per tick (see _registerCoreSystems).
        // A stable per-tick seed component for deterministic per-craft rolls (see MachineBehavior).
        this.clock = 0;

        // World seed for terrain generation; set by Game, restored from a save.
        this.seed = 0;

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
    }

    /**
     * Registers the engine-owned systems that bracket every tick.
     * @private
     * @returns {void}
     */
    _registerCoreSystems() {
        // Per-phase system entries {order, seq, system}, kept sorted and run in order by tick(phase).
        this._systemSeq = 0;
        this.systems = {};
        for (const phase of TICK_PHASE_ORDER) {
            this.systems[phase] = [];
        }
        this.registerSystem(TickPhase.SUBMIT_INTENTS, () => this.transfers.resetTick());
        this.registerSystem(TickPhase.SUBMIT_INTENTS, () => {
            this.clock += 1;
        });
        this.registerSystem(TickPhase.RESOLVE_TRANSFERS, () => this.transfers.resolve());
        this.registerSystem(TickPhase.CONSUME_INPUTS, () => this.transfers.flushSinks());
        this.registerSystem(TickPhase.COMMIT_TRANSFERS, () => this.transfers.commit());
        this.registerSystem(TickPhase.EMIT_RENDER, () => this.render.emit());
    }

    /**
     * Initializes the event, metrics, and observation sinks.
     * @private
     * @returns {void}
     */
    _initRenderSinks() {
        // Sink for domain events (placement/path/delete + port-item render deltas). Game broadcasts each
        // synchronously by chunk; tests install an EventCollector. Null until one is installed.
        this._eventSink = null;
        // Sink for metrics facts; unlike _eventSink, ignores chunk observation.
        this._metricsSink = null;
        // Whether any session is watching a chunk. Emitters skip building an event nobody receives; a
        // session that subscribes later gets the state through chunkSync, not the missed deltas.
        this._chunkObserved = () => false;
        // Bumped whenever the answer `_chunkObserved` gives could have changed, so a system caching
        // "is this thing watched" per entity can revalidate on an integer compare instead of asking
        // again every tick. Starts at 1, leaving 0 as "never computed" for those caches.
        this._observerGeneration = 1;
    }

    /**
     * Passes a domain event to the event sink.
     * @param {AbstractChunkRoutedEvent} event
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
     * @param {function(AbstractChunkRoutedEvent): void} sink
     * @param {function(number): boolean} [chunkObserved]
     * @returns {void}
     */
    setEventSink(sink, chunkObserved) {
        this._eventSink = sink;
        this._chunkObserved = chunkObserved === undefined ? () => true : chunkObserved;
        this.invalidateObservers();
    }

    /**
     * Passes a metrics fact to the metrics sink; a no-op if none is installed.
     * @param {number} type METRICS_FACT_TYPE_*
     * @param {number} playerId PLAYER_ID_NONE when not player-scoped
     * @param {number} [category]
     * @param {number} [amount]
     * @param {number} [tag]
     * @returns {void}
     */
    emitMetrics(type, playerId, category, amount, tag) {
        if (this._metricsSink !== null) {
            this._metricsSink(type, playerId, category, amount, tag);
        }
    }

    /**
     * Sets the sink each emitted metrics fact is delivered to.
     * @param {function(number, number, number, number, number): void} sink
     * @returns {void}
     */
    setMetricsSink(sink) {
        this._metricsSink = sink;
    }

    /**
     * Sets the predicate deciding whether a player may modify a chunk.
     * @param {function(number, number): boolean} gate - (playerId, chunk) -> allowed
     * @returns {void}
     */
    setPlacementGate(gate) {
        this._placementGate = gate;
    }

    /**
     * Whether `playerId` may modify `chunk`. Engine-originated messages (PLAYER_ID_NONE) are
     * trusted: their parent message already passed the gate.
     * @param {number} playerId
     * @param {number} chunk
     * @returns {boolean}
     */
    placementAllowed(playerId, chunk) {
        if (playerId === PLAYER_ID_NONE || this._placementGate === null) {
            return true;
        }
        return this._placementGate(playerId, chunk);
    }

    /**
     * Sets the resolver a spawn queries for the placing chunk's current owner, cached onto the placed object.
     * @param {function(number): number} resolver - chunk -> playerId (PLAYER_ID_NONE if unclaimed)
     * @returns {void}
     */
    setChunkOwnerResolver(resolver) {
        this._chunkOwnerResolver = resolver;
    }

    /**
     * The current owner of `chunk`, or PLAYER_ID_NONE when no resolver is installed (tests without
     * a Game) or the chunk is unclaimed.
     * @param {number} chunk
     * @returns {number}
     */
    chunkOwnerOf(chunk) {
        if (this._chunkOwnerResolver === null) {
            return PLAYER_ID_NONE;
        }
        return this._chunkOwnerResolver(chunk);
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
     * @returns {Promise<void>}
     */
    async init() {
        this.world = new World();
        this.components.bindAll();
        if (this.modRegistry !== null) {
            // The registry must be frozen (typeIds assigned) before content wires up; the accessors
            // throw otherwise. The generic entity host installs every derived type's behavior first,
            // then bespoke sim mods register theirs.
            this._fluidTypes = this.modRegistry.fluidTypes;
            this.placed = new PlacedObjects(this, this.modRegistry);
            this.overworldBake = new OverworldBake(this, this.placed);
            this.workers = new WorkerNetworks(this, this.placed);
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
     * Grows the port-indexed state kept outside the Port component itself, so every column stays
     * addressable by port eid. Registered with the component registry as the Port component's
     * grow listener.
     * @private
     * @param {number} capacity
     * @returns {void}
     */
    _growPortColumns(capacity) {
        const fluidSource = new Int32Array(capacity).fill(EMPTY);
        fluidSource.set(this._portFluidSource);
        this._portFluidSource = fluidSource;
        const fluid = new Uint8Array(capacity);
        fluid.set(this._portFluid);
        this._portFluid = fluid;
        for (const portColumn of this._portColumns) {
            portColumn.grow(capacity);
        }
        this.transfers.growPortColumns(capacity);
        this.render.growPortColumns(capacity);
    }

    /**
     * Registers a module column indexed by port eid, which the engine grows with the Port component.
     * Lets a module index per-port state the way the engine does, instead of keying a Map on port eids.
     * @param {number} [fill] - the value an unwritten port reads as
     * @returns {PortColumn}
     */
    registerPortColumn(fill=0) {
        const portColumn = new PortColumn(this._portDef.capacity, fill);
        this._portColumns.push(portColumn);
        return portColumn;
    }

    /**
     * Creates a port carrying `item` (EMPTY for an empty port).
     * @param {number} [item]
     * @returns {number} the port eid
     */
    createPort(item=EMPTY) {
        const eid = this.world.addEntity();
        this.components.attach(this._portDef, eid);
        // The world recycles eids, so clear any shadow/flag the previous tenant left behind.
        this.render.forgetPort(eid);
        this._portFluid[eid] = 0;
        this._portFluidSource[eid] = EMPTY;
        this.setPortItem(eid, item);
        return eid;
    }

    /**
     * Declares the fluid type a producer emits into `eid` (EMPTY to clear).
     * @param {number} eid
     * @param {number} fluidType
     * @returns {void}
     */
    setPortFluidSource(eid, fluidType) {
        this._portFluidSource[eid] = fluidType;
        this._fluidSourceGeneration += 1;
    }

    /**
     * @returns {number} the current fluid-source generation; a cache stamped with it is still valid
     */
    get fluidSourceGeneration() {
        return this._fluidSourceGeneration;
    }

    /**
     * @param {number} eid
     * @returns {number} the fluid type produced into the port, or EMPTY
     */
    portFluidSource(eid) {
        return this._portFluidSource[eid];
    }

    /**
     * Claims a port for fluid machinery (a pipe network edge or tank port); a port may be claimed
     * by more than one owner when a pipe and a tank share an edge, so {@link isFluidPort} only
     * clears once every owner has called {@link unmarkFluidPort}.
     * @param {number} eid
     * @returns {void}
     */
    markFluidPort(eid) {
        this._portFluid[eid] += 1;
    }

    /**
     * Releases one fluid-machinery claim taken by {@link markFluidPort}.
     * @param {number} eid
     * @returns {void}
     */
    unmarkFluidPort(eid) {
        this._portFluid[eid] -= 1;
    }

    /**
     * @param {number} eid
     * @returns {boolean} whether the port is claimed by any fluid machinery
     */
    isFluidPort(eid) {
        return this._portFluid[eid] > 0;
    }

    /**
     * @param {number} item
     * @returns {boolean} whether `item` is a declared fluid payload
     */
    isFluid(item) {
        return this._fluidTypes.has(item);
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
        const key = tileVariantId(tileId(x, y), direction);
        let eid = this._portsByEdge.get(key);
        if (eid === undefined) {
            eid = this.createPort();
            this.space.setPosition(eid, x, y, direction);
            this._portsByEdge.set(key, eid);
        }
        return eid;
    }

    /**
     * The existing port on the edge "flow entering tile (x, y) going `direction`", or null —
     * {@link portAt} without the create, for an emitter that must not strand a payload in a port
     * nothing consumes.
     * @param {number} x
     * @param {number} y
     * @param {number} direction
     * @returns {number|null} the port eid
     */
    peekPortAt(x, y, direction) {
        const eid = this._portsByEdge.get(tileVariantId(tileId(x, y), direction));
        if (eid === undefined) {
            return null;
        }
        return eid;
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
        for (const def of this.components.defs) {
            if (def.snapshotOnly) {
                continue;
            }
            const eidFields = def.fields.filter(field => field.kind === "eid");
            if (eidFields.length === 0) {
                continue;
            }
            for (const slot of this.components.slotsOf(def)) {
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

        const doomed = [];
        for (const eid of this.world.query([this._portDef.store])) {
            if (!referenced.has(eid)) {
                doomed.push(eid);
            }
        }
        // Before the entities go: the edge key reads their Position, and a port dying with a drawn
        // item owes the client a clear no later diff would send.
        for (const eid of doomed) {
            if (this.world.hasComponent(eid, this.space.positionDef.store)) {
                this._portsByEdge.delete(this._edgeKey(eid));
            }
        }
        this.render.retirePorts(doomed);
        for (const eid of doomed) {
            this.world.removeEntity(eid);
        }
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
        if (item === EMPTY && this.Port.item[eid] !== EMPTY) {
            this.render.noteCleared(eid);
        }
        this.Port.item[eid] = item;
        this.render.markDirty(eid);
    }

    /**
     * Empties a port a consumer ate from, so its clear renders as a glide into the consumer.
     * @param {number} eid
     * @returns {void}
     */
    consumePortItem(eid) {
        this.Port.item[eid] = EMPTY;
        this.render.noteConsumed(eid);
        this.render.markDirty(eid);
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
     * @returns {{saveFormat:number, gameVersion:string, components:object[], globals:object}}
     */
    serialize() {
        for (const hook of this._serializeHooks) {
            hook();
        }
        const components = this.components.defs.map(def => {
            const rows = [];
            for (const slot of this.components.slotsOf(def)) {
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
        const globals = {nextObjectId: this._nextObjectId, clock: this.clock, seed: this.seed, ...this.globals};
        for (const key of Object.keys(globals)) {
            if (!Number.isSafeInteger(globals[key])) {
                throw new RangeError(`GameEngine.serialize: global "${key}" is not a safe integer: ${globals[key]}`);
            }
        }
        // Every object type's name, in typeId order — deserialize compares this against the current
        // loadout so a stale save (object types added/removed/reordered since) fails loudly at load
        // time instead of resolving a component row's typeId to the wrong behavior mid-tick.
        let objectTypeNames = null;
        if (this.modRegistry !== null) {
            objectTypeNames = this.modRegistry.objectTypes.map(type => type.name);
        }
        // gameVersion is for humans; load decides on saveFormat.
        return {
            saveFormat: SAVE_FORMAT,
            gameVersion: GAME_VERSION,
            components: components,
            globals: globals,
            objectTypeNames: objectTypeNames,
        };
    }

    /**
     * Throws when `snapshot` was written against a different object-type layout than the current
     * loadout: typeIds are positional (assigned by registration order at ModRegistry.freeze()), so
     * adding/removing/reordering a mod's object types shifts every typeId after the change, and a
     * component row's saved typeId would silently resolve to the wrong ObjectType/behavior — a crash
     * deep in an unrelated tick, far from the real cause. A pure append (current has every saved name
     * as a prefix, plus new ones after) is fine; anything else is not. No-op when this engine has no
     * modRegistry (synthetic test engines never persist for real).
     * @private
     * @param {{objectTypeNames: string[]|null|undefined}} snapshot
     * @returns {void}
     */
    _assertLoadoutCompatible(snapshot) {
        if (this.modRegistry === null) {
            return;
        }
        const current = this.modRegistry.objectTypes.map(type => type.name);
        const saved = snapshot.objectTypeNames;
        const prefixMatches = saved !== null && saved !== undefined && saved.length <= current.length
            && saved.every((name, i) => name === current[i]);
        if (!prefixMatches) {
            throw new Error(
                "Save is incompatible with the current mod loadout: object types were added, removed, "
                + "or reordered since this save was written, so typeIds no longer mean the same thing. "
                + `Saved: [${saved === null || saved === undefined ? "unknown (pre-dates this check)" : saved.join(", ")}]. `
                + `Current: [${current.join(", ")}]. Delete or migrate the save file.`
            );
        }
    }

    /**
     * Throws when `snapshot` is not at the format this build reads.
     * @private
     * @param {{saveFormat: number|undefined}} snapshot
     * @returns {void}
     */
    _assertSnapshotFormat(snapshot) {
        if (snapshot.saveFormat === SAVE_FORMAT) {
            return;
        }
        let found = snapshot.saveFormat;
        if (found === undefined || found === null) {
            found = "unstamped (pre-dates save formats)";
        }
        throw new Error(
            `Save is format ${found}, this build reads ${SAVE_FORMAT}: `
            + "run it through migrateSnapshot() before deserializing."
        );
    }

    /**
     * Throws when `snapshot`'s components no longer match the ones this build registers.
     * Rows restore by name against the current ComponentDefs: a dropped component crashes mid-restore,
     * and a drifted field restores silently as a zero-filled column or an i32 read as an eid.
     * @private
     * @param {{components: object[]}} snapshot
     * @returns {void}
     */
    _assertComponentsCompatible(snapshot) {
        const mismatches = [];
        const savedNames = new Set();
        for (const component of snapshot.components) {
            savedNames.add(component.name);
            const def = this.components.find(component.name);
            if (def === undefined) {
                mismatches.push(`component "${component.name}" is in the save but no longer registered`);
                continue;
            }
            const savedKinds = new Map(component.fields.map(field => [field.name, field.kind]));
            for (const field of def.fields) {
                const savedKind = savedKinds.get(field.name);
                if (savedKind === undefined) {
                    mismatches.push(`${component.name}.${field.name} is registered but missing from the save`);
                }
                else if (savedKind !== field.kind) {
                    mismatches.push(`${component.name}.${field.name} was saved as "${savedKind}", now "${field.kind}"`);
                }
            }
            const currentNames = new Set(def.fields.map(field => field.name));
            for (const name of savedKinds.keys()) {
                if (!currentNames.has(name)) {
                    mismatches.push(`${component.name}.${name} is in the save but no longer registered`);
                }
            }
        }
        for (const def of this.components.defs) {
            if (!savedNames.has(def.name)) {
                mismatches.push(`component "${def.name}" is registered but missing from the save`);
            }
        }
        if (mismatches.length > 0) {
            throw new Error(
                "Save is incompatible with this build's components: "
                + `${mismatches.join("; ")}. Add a save migration, or delete the save file.`
            );
        }
    }

    /**
     * Rebuilds the world from a {@link serialize} snapshot: fresh entities for every saved eid (eid
     * columns remapped so references stay consistent), then the engine's derived indexes and each
     * module's via its rebuild hook.
     * @param {{components:object[], globals:object}} snapshot
     * @returns {void}
     */
    deserialize(snapshot) {
        this._assertSnapshotFormat(snapshot);
        this._assertLoadoutCompatible(snapshot);
        this._assertComponentsCompatible(snapshot);
        this.world = new World();
        this.components.bindAll();
        this.components.clearAll();
        this._portsByEdge = new Map();
        // Drop the prior world's render/tick state so its stale eids never leak into the new world.
        this._portFluid.fill(0);
        this._portFluidSource.fill(EMPTY);
        this.render.reset();
        this.transfers.resetTick();

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
            const def = this.components.find(component.name);
            for (const row of component.rows) {
                const eid = remap.get(row.eid);
                this.components.attach(def, eid);
                const slot = def.slot(eid);
                for (const field of def.fields) {
                    const raw = row[field.name];
                    def.store[field.name][slot] = field.kind === "eid" ? translate(raw) : raw;
                }
            }
        }

        this._nextObjectId = snapshot.globals.nextObjectId;
        this.clock = snapshot.globals.clock === undefined ? 0 : snapshot.globals.clock;
        this.seed = snapshot.globals.seed;
        for (const key of Object.keys(snapshot.globals)) {
            if (key !== "nextObjectId" && key !== "clock" && key !== "seed") {
                this.globals[key] = snapshot.globals[key];
            }
        }

        this._rebuildPortEdges();
        this.space.rebuild();
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
     * @returns {Int32Array}
     */
    _edgePortEids() {
        return this.world.query([this._portDef.store, this.space.positionDef.store]);
    }

    /**
     * @private
     * @param {number} eid - an edge port
     * @returns {number} its index key
     */
    _edgeKey(eid) {
        const tile = tileId(this.Position.x[eid], this.Position.y[eid]);
        return tileVariantId(tile, this.Position.direction[eid]);
    }

    /**
     * A mod registers a message handler (returns true if it handled the message).
     * @param {function(AbstractMessage, number): boolean} handler - message, acting playerId
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
     * A mod registers a cross-object placement veto, consulted for every placed-object spawn.
     * @param {function(ObjectType, number, number, Direction): boolean} guard - returns false to veto
     * @returns {void}
     */
    registerPlacementGuard(guard) {
        this._placementGuards.push(guard);
    }

    /**
     * Whether every registered placement guard allows spawning `type` at (x, y).
     * @param {ObjectType} type
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {boolean}
     */
    placementGuardsAllow(type, x, y, direction) {
        return this._placementGuards.every(guard => guard(type, x, y, direction));
    }

    /**
     * A mod registers a despawn listener, called for every placed-object delete before the entity
     * is destroyed.
     * @param {function(number, number): void} listener - (eid, objectId)
     * @returns {void}
     */
    registerDespawnListener(listener) {
        this._despawnListeners.push(listener);
    }

    /**
     * @param {number} eid
     * @param {number} objectId
     * @returns {void}
     */
    notifyDespawn(eid, objectId) {
        for (const listener of this._despawnListeners) {
            listener(eid, objectId);
        }
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
     * @template T
     * @param {Function} key - the service's marker class
     * @param {T} instance
     * @returns {T} the instance
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
     * @template T
     * @param {{new(...args: *): T}} key - the service's marker class
     * @returns {T}
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
     * @returns {InspectHeartbeatEvent|null}
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
     * @param {number} [playerId] - the acting player; PLAYER_ID_NONE for engine-originated messages
     * @returns {boolean}
     */
    applyMessage(message, playerId = PLAYER_ID_NONE) {
        // Both ownership gates live here, above every create/delete handler (bespoke ones too).
        if (message instanceof CreateObjectMessage
            && !this.placementAllowed(playerId, chunkId(message.x, message.y))) {
            return true;
        }
        let handled;
        if (message instanceof DeleteObjectMessage) {
            // Gate before untrack: a rejection after it would leave the object half-deleted.
            if (!this._deleteAllowed(message.id, playerId)) {
                return true;
            }
            this.untrack(message.id);
            handled = this._messageHandlers.some(handler => handler(message, playerId));
            // A delete (and any belt relink it triggered) can strand ports; destroy them now.
            this.collectUnreferencedPorts();
        } else {
            handled = this._messageHandlers.some(handler => handler(message, playerId));
        }
        if (this.workers !== null) {
            this.workers.ensureFresh();
        }
        return handled;
    }

    /**
     * Whether `playerId` may delete the object; unknown ids pass through to the handlers.
     * @private
     * @param {number} objectId
     * @param {number} playerId
     * @returns {boolean}
     */
    _deleteAllowed(objectId, playerId) {
        if (this.placed === null) {
            return true;
        }
        const eid = this.placed.eidByObjectId(objectId);
        if (eid === undefined) {
            return true;
        }
        return this.placementAllowed(playerId, chunkId(this.Position.x[eid], this.Position.y[eid]));
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
        // After the contributors: the client resolves a port item against the object/path
        // the contributors' events just recreated.
        const portItems = this.render.chunkSync(chunk);
        if (portItems !== null) {
            events.push(portItems);
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
     * The cells a definition occupies at (x, y) facing `direction`, on the layers its type
     * declares (surface by default; a belt kind may sit on an underground axis layer).
     * @param {ObjectType} definition
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {{x:number, y:number, layer:string}[]}
     */
    footprint(definition, x, y, direction) {
        return definition.positionLayerTiles(direction).flatMap(group =>
            group.cells.map(cell => ({x: x + cell.x, y: y + cell.y, layer: group.layer})));
    }

    /**
     * Occupies a placed object's footprint, tagged with its client id so a delete destroys it.
     * @param {number} objectId
     * @param {{x:number, y:number, layer:string}[]} footprint
     * @returns {void}
     */
    track(objectId, footprint) {
        this.space.occupy(footprint, objectId);
    }

    /**
     * Destroys a deleted object's footprint.
     * @param {number} objectId
     * @returns {void}
     */
    untrack(objectId) {
        this.space.destroyOwnerCells(objectId);
    }
}
