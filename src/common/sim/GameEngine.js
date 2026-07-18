import {createWorld, addEntity, addComponent, hasComponent, removeEntity, entityExists, query} from "bitecs";
import {rotate} from "@/common/util.js";
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


/**
 * bitECS-backed simulation engine Game drives: the port-transfer core over typed-array component
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

        // Registered component stores, in definition order: {name, fields, store, capacity}. The generic
        // serializer walks these, so any state kept here round-trips for free (see serialize).
        this._components = [];
        this._componentByName = new Map();

        // Port component: item type per port eid (EMPTY when unoccupied). An edge port also carries
        // Position for the edge it sits on, so _portsByEdge rebuilds from the world; a port with no
        // Position is not an edge port.
        this._portDef = this.defineComponent("Port", [
            {name: "item", fill: EMPTY},
        ]);
        this.Port = this._portDef.store;

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

        // Out-ports whose resting item is drawn: eid -> {x, y}. Modules register theirs. Keyed so
        // re-registration is idempotent and a removed path's port can be unregistered (paths churn).
        this.renderedPorts = new Map();
        // Last emitted item per rendered port, so EMIT_RENDER emits only changes.
        this._portShadow = new Map();
        // Ports unregistered while holding a rendered item (eid -> {x, y}): a pending clear, cancelled if
        // the port is re-registered in the same edit (so a churned-but-surviving port stays static, no
        // clear+set glide). Flushed by the render diff.
        this._pendingClear = new Map();
        // Sink for domain events (placement/path/delete + port-item render deltas). Game broadcasts each
        // synchronously by chunk; tests install an EventCollector. Defaults to dropping (no session).
        this._eventSink = () => {};

        this._resetTick();
    }

    /**
     * Passes a domain event to the event sink.
     * @param {AbstractTilePositionedEvent} event
     * @returns {void}
     */
    emitEvent(event) {
        this._eventSink(event);
    }

    /**
     * Sets the sink each emitted event is delivered to.
     * @param {function(AbstractTilePositionedEvent): void} sink
     * @returns {void}
     */
    setEventSink(sink) {
        this._eventSink = sink;
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
        for (const [eid, position] of this._pendingClear) {
            this.emitEvent(new PortItemClearEvent(position.x, position.y, eid));
            this._portShadow.delete(eid);
        }
        this._pendingClear.clear();

        for (const [eid, position] of this.renderedPorts) {
            const item = this.Port.item[eid];
            const previous = this._portShadow.has(eid) ? this._portShadow.get(eid) : EMPTY;
            if (item === previous) {
                continue;
            }
            if (item === EMPTY) {
                this.emitEvent(new PortItemClearEvent(position.x, position.y, eid));
                this._portShadow.delete(eid);
            } else {
                this.emitEvent(new PortItemSetEvent(position.x, position.y, eid, item));
                this._portShadow.set(eid, item);
            }
        }
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
        this.world = createWorld();
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
        const dest = this._destBySource.get(source);
        if (dest === undefined) {
            return EMPTY;
        }
        return dest;
    }

    /**
     * Whether a transfer resolved into this destination this tick. Lets a producer detect its output
     * was delivered (its create intent is source-less, so resolvedDestFor can't key on it).
     * @param {number} dest
     * @returns {boolean}
     */
    wasResolvedDest(dest) {
        return this._resolvedDests.has(dest);
    }

    /**
     * As {@link wasResolvedDest} but only for unmanaged (managed=0) transfers — the form belts submit,
     * where a resolved out-port means the path may pop this tick.
     * @param {number} dest
     * @returns {boolean}
     */
    resolvedUnmanagedDest(dest) {
        return this._unmanagedResolvedDests.has(dest);
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
        // Lookup indices over _resolved, so per-entity queries stay O(1).
        this._destBySource = new Map();
        this._resolvedDests = new Set();
        this._unmanagedResolvedDests = new Set();
        // Managed destination-less sources the engine drains this tick.
        this._sinks = [];
    }

    /**
     * Registers a component store: SoA Int32Array columns grown by doubling, tracked for generic
     * serialization. `fields` are {name, kind?, fill?} — kind "eid" marks an entity-reference column
     * remapped on deserialize (default "i32"); fill is the empty-slot value (default 0). Modules call
     * this so their state round-trips with no bespoke save code.
     * @param {string} name
     * @param {{name:string, kind?:string, fill?:number}[]} fieldSpecs
     * @param {{snapshotOnly?:boolean}} [options] - snapshotOnly components hold state materialized at
     *     save (belt paths), not kept in sync during play, so the port sweep ignores their eid fields
     *     (the module's live pin hook is authoritative instead)
     * @returns {{name:string, fields:object[], store:object, capacity:number}}
     */
    defineComponent(name, fieldSpecs, {snapshotOnly=false}={}) {
        const fields = fieldSpecs.map(spec => ({
            name: spec.name,
            kind: spec.kind === undefined ? "i32" : spec.kind,
            fill: spec.fill === undefined ? 0 : spec.fill,
        }));
        const store = {};
        for (const field of fields) {
            store[field.name] = new Int32Array(PORT_CAPACITY).fill(field.fill);
        }
        const def = {name, fields, store, capacity: PORT_CAPACITY, snapshotOnly};
        this._components.push(def);
        this._componentByName.set(name, def);
        return def;
    }

    /**
     * Grows a component's columns so `eid` is addressable.
     * @private
     * @param {object} def
     * @param {number} eid
     * @returns {void}
     */
    _growComponent(def, eid) {
        if (eid < def.capacity) {
            return;
        }
        let capacity = def.capacity;
        while (capacity <= eid) {
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
        }
        if (def === this._positionDef) {
            this.Position = def.store;
        }
    }

    /**
     * Attaches a component to `eid`, growing its columns first.
     * @private
     * @param {object} def
     * @param {number} eid
     * @returns {void}
     */
    _addComponent(def, eid) {
        this._growComponent(def, eid);
        addComponent(this.world, eid, def.store);
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
        const eid = addEntity(this.world);
        this._addComponent(this._portDef, eid);
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
            const eid = addEntity(this.world);
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
                removeEntity(this.world, eid);
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
                removeEntity(this.world, eid);
            }
        }
    }

    /**
     * The cell entities: those carrying both Position and Occupancy (an edge port has Position alone).
     * @private
     * @returns {number[]}
     */
    _cellEids() {
        return query(this.world, [this._positionDef.store, this._occupancyDef.store]);
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
            for (const eid of query(this.world, [def.store])) {
                for (const field of eidFields) {
                    const target = def.store[field.name][eid];
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

        for (const eid of query(this.world, [this._portDef.store])) {
            if (referenced.has(eid)) {
                continue;
            }
            if (hasComponent(this.world, eid, this._positionDef.store)) {
                this._portsByEdge.delete(this._edgeKey(eid));
            }
            this.renderedPorts.delete(eid);
            this._portShadow.delete(eid);
            this._pendingClear.delete(eid);
            removeEntity(this.world, eid);
        }
    }

    /**
     * Creates an entity carrying `def`'s component.
     * @param {object} def - a descriptor from {@link defineComponent}
     * @returns {number} the entity id
     */
    createEntity(def) {
        const eid = addEntity(this.world);
        this._addComponent(def, eid);
        return eid;
    }

    /**
     * Removes an entity (and all its components) from the world; a no-op for an already-destroyed eid.
     * @param {number} eid
     * @returns {void}
     */
    destroyEntity(eid) {
        if (entityExists(this.world, eid)) {
            removeEntity(this.world, eid);
        }
    }

    /**
     * The entities currently carrying `def`'s component.
     * @param {object} def - a descriptor from {@link defineComponent}
     * @returns {number[]}
     */
    entitiesWith(def) {
        return query(this.world, [def.store]);
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
     * Resolves this tick's intents into resolved transfers via a linear backward propagation over the
     * functional transfer graph.
     * @returns {void}
     */
    resolvePortTransfer() {
        // Pass 1: dedup contenders per destination (a port takes one) — lowest rank wins, tie by
        // source. Destination-less rows mark their source as draining this tick.
        const winnerByDest = new Map();
        const drains = new Set();
        for (const intent of this._intents) {
            if (intent.dest === EMPTY) {
                if (intent.source !== EMPTY) {
                    drains.add(intent.source);
                }
                continue;
            }
            const current = winnerByDest.get(intent.dest);
            if (current === undefined
                || intent.rank < current.rank
                || (intent.rank === current.rank && intent.source < current.source)) {
                winnerByDest.set(intent.dest, intent);
            }
        }

        // Pass 2: a transfer resolves if its destination empties this tick — the destination is
        // empty (destEmpty), or drains, or is itself a resolving source (packed chain shifts as one).
        // Propagate backward: when a port joins the draining set, the transfer feeding it resolves.
        const resolvedSource = new Set(drains);
        const resolvedIntents = [];
        const seen = new Set();
        const queue = [...drains];

        for (const intent of winnerByDest.values()) {
            if (intent.destEmpty) {
                resolvedIntents.push(intent);
                seen.add(intent);
                if (!resolvedSource.has(intent.source)) {
                    resolvedSource.add(intent.source);
                    queue.push(intent.source);
                }
            }
        }

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
        for (const intent of resolvedIntents) {
            if (intent.rank === EMPTY) {
                this._commitResolved(intent);
                continue;
            }
            const current = bestBySource.get(intent.source);
            if (current === undefined
                || intent.rank < current.rank
                || (intent.rank === current.rank && intent.dest < current.dest)) {
                bestBySource.set(intent.source, intent);
            }
        }
        for (const intent of bestBySource.values()) {
            this._commitResolved(intent);
        }

        // Managed destination-less sinks always resolve; the engine drains them in commit.
        for (const intent of this._intents) {
            if (intent.dest === EMPTY && intent.managed && intent.source !== EMPTY) {
                this._sinks.push(intent.source);
            }
        }
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
        // First transfer wins, matching the find() this index replaced.
        if (!this._destBySource.has(intent.source)) {
            this._destBySource.set(intent.source, intent.dest);
        }
        this._resolvedDests.add(intent.dest);
        if (!intent.managed) {
            this._unmanagedResolvedDests.add(intent.dest);
        }
    }

    /**
     * CONSUME_INPUTS: drains resolved managed sinks. Runs before POST_RESOLVE so a producer feeding
     * the same port refills it the same tick.
     * @returns {void}
     */
    flushSinks() {
        for (const source of this._sinks) {
            this.Port.item[source] = EMPTY;
        }
    }

    /**
     * COMMIT_TRANSFERS: applies resolved managed transfers to Port — clears sources, then writes
     * destinations, so a packed chain shifts atomically.
     * @returns {void}
     */
    commitTransfers() {
        for (const transfer of this._resolved) {
            if (transfer.managed && transfer.source !== EMPTY) {
                this.Port.item[transfer.source] = EMPTY;
            }
        }
        for (const transfer of this._resolved) {
            if (transfer.managed && transfer.dest !== EMPTY) {
                this.Port.item[transfer.dest] = transfer.item;
            }
        }
    }

    /**
     * The resolved real transfers (both ends real ports) as "source->dest", ordered by source.
     * @returns {string}
     */
    resolvedEdges() {
        return this._resolved
            .filter(transfer => transfer.source !== EMPTY && transfer.dest !== EMPTY)
            .sort((a, b) => a.source - b.source)
            .map(transfer => `${transfer.source}->${transfer.dest}`)
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
            for (const eid of query(this.world, [def.store])) {
                const row = {eid: eid};
                for (const field of def.fields) {
                    row[field.name] = def.store[field.name][eid];
                }
                rows.push(row);
            }
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
        this.world = createWorld();
        for (const def of this._components) {
            for (const field of def.fields) {
                def.store[field.name].fill(field.fill);
            }
        }
        this._portsByEdge = new Map();
        this._cellByKey = new Map();
        // Drop the prior world's render/tick state so its stale eids never leak into the new world.
        this.renderedPorts = new Map();
        this._portShadow = new Map();
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
            remap.set(old, addEntity(this.world));
        }
        const translate = value => (value === NO_EID ? NO_EID : remap.get(value));

        for (const component of snapshot.components) {
            const def = this._componentByName.get(component.name);
            for (const row of component.rows) {
                const eid = remap.get(row.eid);
                this._addComponent(def, eid);
                for (const field of def.fields) {
                    const raw = row[field.name];
                    def.store[field.name][eid] = field.kind === "eid" ? translate(raw) : raw;
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
        return query(this.world, [this._portDef.store, this._positionDef.store]);
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
