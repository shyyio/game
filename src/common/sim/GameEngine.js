import {createWorld, addEntity, addComponent, removeEntity, entityExists, query} from "bitecs";
import {rotate} from "@/common/util.js";
import {SURFACE_LAYER} from "@/common/constants.js";
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
 * storage, the occupancy/port indexes, (de)serialization, and the mod host — each loaded sim mod
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

        // Port component: item type per port eid (EMPTY when unoccupied) plus the shared edge it sits on
        // (edgeDirection NO_EID when the port is not an edge port), so _portsByEdge rebuilds from the world.
        this._portDef = this.defineComponent("Port", [
            {name: "item", fill: EMPTY},
            {name: "edgeX"},
            {name: "edgeY"},
            {name: "edgeDirection", fill: NO_EID},
        ]);
        this.Port = this._portDef.store;

        // Layer name <-> int code; the surface layer is code 0, mods register the rest (see
        // registerOccupancyLayer). Registration order is deterministic per loadout, so codes are stable
        // across save/load.
        this._layerCodes = new Map();
        this._layerNames = [];
        this.registerOccupancyLayer(SURFACE_LAYER);

        // Occupancy component: one entity per occupied cell {x, y, layer}, tagged with its owner object id
        // (so a delete releases all its cells by query) and a per-cell value read via occupantValueAt
        // (0 for plain footprints; e.g. resource cover stores its resource type). Objects on the same
        // layer collide; different layers coexist.
        this._occupancyDef = this.defineComponent("Occupancy", [
            {name: "x"},
            {name: "y"},
            {name: "layer"},
            {name: "owner", fill: NO_EID},
            {name: "value"},
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
        TICK_PHASE_ORDER.forEach(phase => {
            this.systems[phase] = [];
        });
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
        this._pendingClear.forEach((position, eid) => {
            this.emitEvent(new PortItemClearEvent(position.x, position.y, eid));
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
                this.emitEvent(new PortItemClearEvent(position.x, position.y, eid));
                this._portShadow.delete(eid);
            } else {
                this.emitEvent(new PortItemSetEvent(position.x, position.y, eid, item));
                this._portShadow.set(eid, item);
            }
        });
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
            this.modRegistry.simMods.forEach(mod => mod.setup(this));
        }
    }

    /**
     * @param {TickPhase} phase
     * @returns {void}
     */
    tick(phase) {
        this.systems[phase].forEach(entry => {
            entry.system();
        });
    }

    /**
     * Runs a whole tick (every phase in order).
     * @returns {void}
     */
    tickAll() {
        TICK_PHASE_ORDER.forEach(phase => {
            this.tick(phase);
        });
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
        fields.forEach(field => {
            store[field.name] = new Int32Array(PORT_CAPACITY).fill(field.fill);
        });
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
        def.fields.forEach(field => {
            const grown = new Int32Array(capacity).fill(field.fill);
            grown.set(def.store[field.name]);
            def.store[field.name] = grown;
        });
        def.capacity = capacity;
        if (def === this._portDef) {
            this.Port = def.store;
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
            this.Port.edgeX[eid] = x;
            this.Port.edgeY[eid] = y;
            this.Port.edgeDirection[eid] = direction;
            this._portsByEdge.set(key, eid);
        }
        return eid;
    }

    /**
     * Registers an occupancy layer name, returning its stable int code (idempotent).
     * @param {string} name
     * @returns {number}
     */
    registerOccupancyLayer(name) {
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
    occupancyFree(cells) {
        return cells.every(cell => !this._cellByKey.has(`${cell.x},${cell.y},${cell.layer}`));
    }

    /**
     * The value stored at cell {x, y, layer}, or null when the cell is free.
     * @param {number} x
     * @param {number} y
     * @param {string} layer
     * @returns {number|null}
     */
    occupantValueAt(x, y, layer) {
        const eid = this._cellByKey.get(`${x},${y},${layer}`);
        return eid === undefined ? null : this._occupancyDef.store.value[eid];
    }

    /**
     * Marks each cell occupied, one Occupancy entity per newly taken cell, tagged with `owner` so
     * {@link destroyOwnerCells} can destroy them all on delete.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @param {number} [owner] - the owning object id
     * @param {number} [value] - per-cell value read back via {@link occupantValueAt}
     * @returns {void}
     */
    occupy(cells, owner=NO_EID, value=0) {
        const store = this._occupancyDef.store;
        cells.forEach(cell => {
            const key = `${cell.x},${cell.y},${cell.layer}`;
            if (this._cellByKey.has(key)) {
                return;
            }
            const eid = addEntity(this.world);
            this._addComponent(this._occupancyDef, eid);
            store.x[eid] = cell.x;
            store.y[eid] = cell.y;
            store.layer[eid] = this._layerCodes.get(cell.layer);
            store.owner[eid] = owner;
            store.value[eid] = value;
            this._cellByKey.set(key, eid);
        });
    }

    /**
     * Destroys each cell.
     * @param {{x:number, y:number, layer:string}[]} cells
     * @returns {void}
     */
    destroyCells(cells) {
        cells.forEach(cell => {
            const key = `${cell.x},${cell.y},${cell.layer}`;
            const eid = this._cellByKey.get(key);
            if (eid !== undefined) {
                removeEntity(this.world, eid);
                this._cellByKey.delete(key);
            }
        });
    }

    /**
     * Destroys every cell an object occupied, keyed by the owner id passed to {@link occupy}.
     * @param {number} owner
     * @returns {void}
     */
    destroyOwnerCells(owner) {
        const store = this._occupancyDef.store;
        query(this.world, [store]).forEach(eid => {
            if (store.owner[eid] === owner) {
                this._cellByKey.delete(`${store.x[eid]},${store.y[eid]},${this._layerNames[store.layer[eid]]}`);
                removeEntity(this.world, eid);
            }
        });
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
        this._components.forEach(def => {
            if (def.snapshotOnly) {
                return;
            }
            const eidFields = def.fields.filter(field => field.kind === "eid");
            if (eidFields.length === 0) {
                return;
            }
            query(this.world, [def.store]).forEach(eid => {
                eidFields.forEach(field => {
                    const target = def.store[field.name][eid];
                    if (target !== NO_EID) {
                        referenced.add(target);
                    }
                });
            });
        });
        this._portPins.forEach(hook => {
            Array.from(hook()).forEach(eid => referenced.add(eid));
        });

        query(this.world, [this._portDef.store]).forEach(eid => {
            if (referenced.has(eid)) {
                return;
            }
            if (this.Port.edgeDirection[eid] !== NO_EID) {
                this._portsByEdge.delete(`${this.Port.edgeX[eid]},${this.Port.edgeY[eid]},${this.Port.edgeDirection[eid]}`);
            }
            this.renderedPorts.delete(eid);
            this._portShadow.delete(eid);
            this._pendingClear.delete(eid);
            removeEntity(this.world, eid);
        });
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
     * the same port refills it the same tick.
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
        this._serializeHooks.forEach(hook => hook());
        const components = this._components.map(def => {
            const rows = [];
            query(this.world, [def.store]).forEach(eid => {
                const row = {eid: eid};
                def.fields.forEach(field => {
                    row[field.name] = def.store[field.name][eid];
                });
                rows.push(row);
            });
            return {
                name: def.name,
                fields: def.fields.map(field => ({name: field.name, kind: field.kind})),
                rows: rows,
            };
        });
        // Component values are Int32Array-backed, so always safe; only the unbounded globals (id
        // counters) can overflow past 2^53, where Number silently loses precision.
        const globals = {nextObjectId: this._nextObjectId, ...this.globals};
        Object.keys(globals).forEach(key => {
            if (!Number.isSafeInteger(globals[key])) {
                throw new RangeError(`GameEngine.serialize: global "${key}" is not a safe integer: ${globals[key]}`);
            }
        });
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
        this._components.forEach(def => {
            def.fields.forEach(field => def.store[field.name].fill(field.fill));
        });
        this._portsByEdge = new Map();
        this._cellByKey = new Map();
        // Drop the prior world's render/tick state so its stale eids never leak into the new world.
        this.renderedPorts = new Map();
        this._portShadow = new Map();
        this._pendingClear = new Map();
        this._resetTick();

        // Every eid that appears (as a row's own eid or an eid-field target) needs a fresh entity.
        const referenced = new Set();
        snapshot.components.forEach(component => {
            component.rows.forEach(row => {
                referenced.add(row.eid);
                component.fields.forEach(field => {
                    if (field.kind === "eid" && row[field.name] !== NO_EID) {
                        referenced.add(row[field.name]);
                    }
                });
            });
        });
        const remap = new Map();
        [...referenced].sort((a, b) => a - b).forEach(old => remap.set(old, addEntity(this.world)));
        const translate = value => (value === NO_EID ? NO_EID : remap.get(value));

        snapshot.components.forEach(component => {
            const def = this._componentByName.get(component.name);
            component.rows.forEach(row => {
                const eid = remap.get(row.eid);
                this._addComponent(def, eid);
                def.fields.forEach(field => {
                    const raw = row[field.name];
                    def.store[field.name][eid] = field.kind === "eid" ? translate(raw) : raw;
                });
            });
        });

        this._nextObjectId = snapshot.globals.nextObjectId;
        Object.keys(snapshot.globals).forEach(key => {
            if (key !== "nextObjectId") {
                this.globals[key] = snapshot.globals[key];
            }
        });

        this._rebuildPortEdges();
        this._rebuildOccupancy();
        this._rebuildHooks.forEach(hook => hook(remap));
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuildPortEdges() {
        const store = this._portDef.store;
        query(this.world, [store]).forEach(eid => {
            if (store.edgeDirection[eid] !== NO_EID) {
                this._portsByEdge.set(`${store.edgeX[eid]},${store.edgeY[eid]},${store.edgeDirection[eid]}`, eid);
            }
        });
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuildOccupancy() {
        const store = this._occupancyDef.store;
        query(this.world, [store]).forEach(eid => {
            this._cellByKey.set(`${store.x[eid]},${store.y[eid]},${this._layerNames[store.layer[eid]]}`, eid);
        });
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
        this._chunkSyncers.forEach(contributor => contributor(chunk).forEach(event => events.push(event)));
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
        return definition.geometry.tiles(direction).map(cell => ({x: x + cell.x, y: y + cell.y, layer: SURFACE_LAYER}));
    }

    /**
     * Occupies a placed object's footprint, tagged with its client id so a delete destroys it.
     * @param {number} clientId
     * @param {{x:number, y:number, layer:string}[]} footprint
     * @returns {void}
     */
    track(clientId, footprint) {
        this.occupy(footprint, clientId);
    }

    /**
     * Destroys a deleted object's footprint.
     * @param {number} clientId
     * @returns {void}
     */
    untrack(clientId) {
        this.destroyOwnerCells(clientId);
    }
}
