import {World} from "@/sim/World.js";
import {chunkKeyAt} from "@/common/util.js";
import {portAt} from "@/common/portGeometry.js";
import {PLAYER_REF_NONE} from "@/common/constants.js";
import {ListenerList} from "@/common/ListenerList.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {PlacedObjects} from "@/sim/PlacedObjects.js";
import {OverworldBake} from "@/sim/OverworldBake.js";
import {WorkerNetworks} from "@/sim/WorkerNetworks.js";
import {ComponentRegistry} from "@/sim/ComponentRegistry.js";
import {SpatialIndex} from "@/sim/SpatialIndex.js";
import {TransferResolver} from "@/sim/TransferResolver.js";
import {RenderDiff} from "@/sim/RenderDiff.js";
import {FieldSync} from "@/sim/FieldSync.js";
import {PortIndex} from "@/sim/PortIndex.js";
import {LaneIndex} from "@/sim/LaneIndex.js";
import {SnapshotSerializer} from "@/sim/SnapshotSerializer.js";
import {AbstractSystem} from "@/sim/AbstractSystem.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";


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

        /**
         * The transport lanes items step along, and the items on them.
         * @type {LaneIndex}
         */
        this.lanes = new LaneIndex(this);
        this._initSaveState();
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

        /**
         * Every registered system in registration order; the lifecycle hooks run in it.
         * @type {AbstractSystem[]}
         */
        this.systems = [];

        /**
         * The same systems sorted by order then registration; the tick phases run in it.
         * @type {AbstractSystem[]}
         */
        this.tickSystems = [];

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
        this.Port = this.ports.ports.store;

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

        /**
         * What the client is told about behaviors' synced component fields.
         * @type {FieldSync}
         */
        this.sync = new FieldSync(this);

        this.ports.ports.growListener = capacity => this.ports.growColumns(capacity);
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
        this.Position = this.space.positions.store;
    }

    /**
     * Initializes the persisted globals and the serializer that carries them into a save.
     * @private
     * @returns {void}
     */
    _initSaveState() {
        // Global client-facing object ref, shared across all object types so ids never collide.
        this._nextObjectRef = 1;

        // Whole ticks elapsed, incremented once per tick.
        // A stable per-tick seed component for deterministic per-craft rolls (see MachineBehavior).
        this.clock = 0;

        // World seed for terrain generation; set by Game, restored from a save.
        this.seed = 0;

        // Flat global counters that survive a save; mods stash their own here.
        this.globals = {};

        /**
         * The save format: the whole world to a snapshot and back.
         * @type {SnapshotSerializer}
         */
        this.snapshots = new SnapshotSerializer(this);
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
        /**
         * Notified (playerRef, itemTypeId, amount) when a producer's output is delivered.
         * @type {ListenerList}
         */
        this.itemProduced = new ListenerList();
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
     * @param {number} playerRef PLAYER_REF_NONE when not player-scoped
     * @param {number} [category]
     * @param {number} [amount]
     * @param {number} [tag]
     * @returns {void}
     */
    emitMetrics(type, playerRef, category, amount, tag) {
        if (this._metricsSink !== null) {
            this._metricsSink(type, playerRef, category, amount, tag);
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
     * @param {function(number, number): boolean} gate - (playerRef, chunk) -> allowed
     * @returns {void}
     */
    setPlacementGate(gate) {
        this._placementGate = gate;
    }

    /**
     * Whether `playerRef` may modify `chunk`. Engine-originated messages (PLAYER_REF_NONE) are
     * trusted: their parent message already passed the gate.
     * @param {number} playerRef
     * @param {number} chunkKey
     * @returns {boolean}
     */
    canBuildIn(playerRef, chunkKey) {
        if (playerRef === PLAYER_REF_NONE || this._placementGate === null) {
            return true;
        }
        return this._placementGate(playerRef, chunkKey);
    }

    /**
     * Sets the resolver a spawn queries for the placing chunk's current owner, cached onto the placed object.
     * @param {function(number): number} resolver - chunk -> playerRef (PLAYER_REF_NONE if unclaimed)
     * @returns {void}
     */
    setChunkOwnerResolver(resolver) {
        this._chunkOwnerResolver = resolver;
    }

    /**
     * The current owner of `chunk`, or PLAYER_REF_NONE when no resolver is installed (tests without
     * a Game) or the chunk is unclaimed.
     * @param {number} chunkKey
     * @returns {number}
     */
    getChunkOwnerByChunkKey(chunkKey) {
        if (this._chunkOwnerResolver === null) {
            return PLAYER_REF_NONE;
        }
        return this._chunkOwnerResolver(chunkKey);
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
    isTileObserved(x, y) {
        return this._chunkObserved(chunkKeyAt(x, y));
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
        this.world = new World();
        this.components.bindAll();
        if (this.modRegistry !== null) {
            // The registry must be frozen (objectTypeIds assigned) before content wires up; the accessors
            // throw otherwise. The generic entity host installs every derived type's behavior first,
            // then bespoke sim mods register theirs.
            this._fluidTypes = this.modRegistry.fluidTypes;
            this.placed = new PlacedObjects(this, this.modRegistry);
        }
        // After the host, so a chunk syncs its objects before the lanes over them, and a rebuild
        // binds every cell's ports before the lanes re-derive.
        this.registerSystem(this.lanes);
        if (this.modRegistry !== null) {
            this.placed.installBehaviors();
            this.overworldBake = new OverworldBake(this, this.placed);
            this.workers = new WorkerNetworks(this, this.placed);
            for (const mod of this.modRegistry.simMods) {
                mod.setup(this);
            }
        }
    }

    /**
     * Runs one whole tick: the resolver brackets SUBMIT_INTENTS and closes POST_RESOLVE, then the
     * engine emits what the clients watch.
     * @returns {void}
     */
    tick() {
        this.clock += 1;
        this.transfers.resetTick();
        for (const system of this.tickSystems) {
            system.submitIntents();
        }
        this.transfers.resolve();
        for (const system of this.tickSystems) {
            system.postResolve();
        }
        this.transfers.fillDestinations();
        this.render.emit();
        this.sync.emit();
    }

    /**
     * Registers a system; the engine calls its hooks by name from here on.
     * @template {AbstractSystem} T
     * @param {T} system
     * @returns {T}
     */
    registerSystem(system) {
        if (!(system instanceof AbstractSystem)) {
            throw new TypeError("a system extends AbstractSystem");
        }
        this.systems.push(system);
        this.tickSystems = this.systems.slice().sort((a, b) => a.order - b.order);
        return system;
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
        return {nextObjectRef: this._nextObjectRef, clock: this.clock, seed: this.seed, ...this.globals};
    }

    /**
     * Restores what {@link saveGlobals} wrote; a pre-clock save reads as tick 0.
     * @param {object} globals
     * @returns {void}
     */
    restoreGlobals(globals) {
        this._nextObjectRef = globals.nextObjectRef;
        this.clock = globals.clock === undefined ? 0 : globals.clock;
        this.seed = globals.seed;
        for (const key of Object.keys(globals)) {
            if (key !== "nextObjectRef" && key !== "clock" && key !== "seed") {
                this.globals[key] = globals[key];
            }
        }
    }

    /**
     * Creates the next global client-facing object ref.
     * @returns {number}
     */
    createObjectRef() {
        const id = this._nextObjectRef;
        this._nextObjectRef += 1;
        return id;
    }

    /**
     * Whether every registered system allows spawning `type` at (x, y).
     * @param {ObjectType} type
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {boolean}
     */
    isPlacementAllowed(type, x, y, direction) {
        return this.systems.every(system => system.isPlacementAllowed(type, x, y, direction));
    }

    /**
     * @param {number} eid
     * @param {number} objectRef
     * @returns {void}
     */
    notifySpawn(eid, objectRef) {
        for (const system of this.systems) {
            system.onSpawn(eid, objectRef);
        }
    }

    /**
     * @param {number} eid
     * @param {number} objectRef
     * @returns {void}
     */
    notifyDespawn(eid, objectRef) {
        for (const system of this.systems) {
            system.onDespawn(eid, objectRef);
        }
    }

    /**
     * @param {number} chunkKey
     * @returns {void}
     */
    notifyChunkChanged(chunkKey) {
        for (const system of this.systems) {
            system.onChunkChanged(chunkKey);
        }
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
     * @param {number} objectRef
     * @returns {InspectHeartbeatEvent|null}
     */
    inspectSnapshot(objectRef) {
        for (const system of this.systems) {
            const snapshot = system.inspect(objectRef);
            if (snapshot !== null) {
                return snapshot;
            }
        }
        return null;
    }

    /**
     * @param {AbstractMessage} message
     * @param {number} [playerRef] - the acting player; PLAYER_REF_NONE for engine-originated messages
     * @returns {boolean}
     */
    applyMessage(message, playerRef = PLAYER_REF_NONE) {
        // Both ownership gates live here, above every create/delete handler (bespoke ones too).
        if (message instanceof CreateObjectMessage
            && !this.canBuildIn(playerRef, chunkKeyAt(message.x, message.y))) {
            return true;
        }
        let handled;
        if (message instanceof DeleteObjectMessage) {
            // Gate before untrack: a rejection after it would leave the object half-deleted.
            if (!this._isDeleteAllowed(message.objectRef, playerRef)) {
                return true;
            }
            this.untrack(message.objectRef);
            handled = this._dispatchMessage(message, playerRef);
            // A delete (and any belt relink it triggered) can strand ports; destroy them now.
            this.ports.collectUnreferenced();
        } else {
            handled = this._dispatchMessage(message, playerRef);
        }
        if (this.workers !== null) {
            this.workers.ensureFresh();
        }
        return handled;
    }

    /**
     * Deletes every placed object of a type, as the engine rather than a player: no ownership gate.
     * @param {number} objectTypeId
     * @returns {number} how many were deleted
     */
    removeObjectsOfType(objectTypeId) {
        const eids = this.placed.getEidsByTypeId(objectTypeId);
        for (const eid of eids) {
            const message = new DeleteObjectMessage(this.placed.getObjectRefByEid(eid));
            this.untrack(message.objectRef);
            this._dispatchMessage(message, PLAYER_REF_NONE);
        }
        this.ports.collectUnreferenced();
        return eids.length;
    }

    /**
     * @private
     * @param {AbstractMessage} message
     * @param {number} playerRef
     * @returns {boolean} whether a system handled it
     */
    _dispatchMessage(message, playerRef) {
        return this.systems.some(system => system.dispatchMessage(message, playerRef));
    }

    /**
     * Whether `playerRef` may delete the object; unknown ids pass through to the handlers.
     * @private
     * @param {number} objectRef
     * @param {number} playerRef
     * @returns {boolean}
     */
    _isDeleteAllowed(objectRef, playerRef) {
        if (this.placed === null) {
            return true;
        }
        const eid = this.placed.findEidByObjectRef(objectRef);
        if (eid === undefined) {
            return true;
        }
        return this.canBuildIn(playerRef, chunkKeyAt(this.Position.x[eid], this.Position.y[eid]));
    }

    /**
     * @param {number} chunkKey
     * @returns {object[]}
     */
    chunkSync(chunkKey) {
        const events = [];
        for (const system of this.systems) {
            for (const event of system.chunkSync(chunkKey)) {
                events.push(event);
            }
        }
        // After the systems: the client patches synced fields onto, and resolves a port item
        // against, the object/path the contributors' events just recreated.
        for (const event of this.sync.chunkSync(chunkKey)) {
            events.push(event);
        }
        const portItems = this.render.chunkSync(chunkKey);
        if (portItems !== null) {
            events.push(portItems);
        }
        return events;
    }

    /**
     * Resolves the shared edge port for a PortDefinition on an object placed with its origin tile
     * at (x, y) facing `direction`: the definition's UP-frame offset and flow direction rotated by
     * the placement. `tile` is the tile the flow enters, which is where a rendered port's item is
     * drawn.
     * @param {PortDefinition} port
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @returns {{port:number, tile:{x:number, y:number}}}
     */
    getPortAt(port, x, y, direction) {
        const placed = portAt(port, x, y, direction);
        const tile = {x: placed.x, y: placed.y};
        return {port: this.ports.getPortEidAt(placed.x, placed.y, placed.direction), tile};
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
    getFootprintAt(definition, x, y, direction) {
        return definition.getPositionLayerTilesByDirection(direction).flatMap(group =>
            group.cells.map(cell => ({x: x + cell.x, y: y + cell.y, layer: group.layer})));
    }

    /**
     * Occupies a placed object's footprint, tagged with its client id so a delete destroys it.
     * @param {number} objectRef
     * @param {{x:number, y:number, layer:string}[]} footprint
     * @returns {void}
     */
    track(objectRef, footprint) {
        this.space.occupy(footprint, objectRef);
    }

    /**
     * Destroys a deleted object's footprint.
     * @param {number} objectRef
     * @returns {void}
     */
    untrack(objectRef) {
        this.space.destroyOwnerCells(objectRef);
    }
}
