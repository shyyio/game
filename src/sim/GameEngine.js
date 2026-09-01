import {World} from "@/sim/World.js";
import {chunkId} from "@/common/util.js";
import {portAt} from "@/common/portGeometry.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {PlacedObjects} from "@/sim/PlacedObjects.js";
import {OverworldBake} from "@/sim/OverworldBake.js";
import {WorkerNetworks} from "@/sim/WorkerNetworks.js";
import {ComponentRegistry} from "@/sim/ComponentRegistry.js";
import {SpatialIndex} from "@/sim/SpatialIndex.js";
import {TransferResolver} from "@/sim/TransferResolver.js";
import {RenderDiff} from "@/sim/RenderDiff.js";
import {PortIndex} from "@/sim/PortIndex.js";
import {SnapshotSerializer} from "@/sim/SnapshotSerializer.js";
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
        /**
         * The ports items flow through, and the shared edge index over them.
         * @type {PortIndex}
         */
        this.ports = new PortIndex(this);
        this.Port = this.ports.Port;

        /**
         * What the client is told about resting port items.
         * @type {RenderDiff}
         */
        this.render = new RenderDiff(this, this.ports.capacity);

        /**
         * The port-transfer protocol: submitted intents, this tick's resolutions, and the commit.
         * @type {TransferResolver}
         */
        this.transfers = new TransferResolver(this, this.ports.capacity);

        this.components.onGrow(this.ports.def, capacity => this.ports.growColumns(capacity));
    }

    /**
     * Builds the spatial index: positions, layers, and the occupied cells over them.
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
    }

    /**
     * Initializes the persisted globals and the serializer that carries them into a save.
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

        /**
         * The save format: the whole world to a snapshot and back.
         * @type {SnapshotSerializer}
         */
        this.snapshots = new SnapshotSerializer(this);
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
            this.placed.installBehaviors();
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
     * @param {number} item
     * @returns {boolean} whether `item` is a declared fluid payload
     */
    isFluid(item) {
        return this._fluidTypes.has(item);
    }

    /**
     * The persisted globals as one flat object: the engine's own counters plus whatever mods stashed.
     * @returns {object}
     */
    saveGlobals() {
        return {nextObjectId: this._nextObjectId, clock: this.clock, seed: this.seed, ...this.globals};
    }

    /**
     * Restores what {@link saveGlobals} wrote; a pre-clock save reads as tick 0.
     * @param {object} globals
     * @returns {void}
     */
    restoreGlobals(globals) {
        this._nextObjectId = globals.nextObjectId;
        this.clock = globals.clock === undefined ? 0 : globals.clock;
        this.seed = globals.seed;
        for (const key of Object.keys(globals)) {
            if (key !== "nextObjectId" && key !== "clock" && key !== "seed") {
                this.globals[key] = globals[key];
            }
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
            this.ports.collectUnreferenced();
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
        const placed = portAt(portVec, x, y, direction);
        const tile = {x: placed.x, y: placed.y};
        return {port: this.ports.at(placed.x, placed.y, placed.direction), tile};
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
