import {tileId, tileVariantId} from "@/common/util.js";
import {EMPTY, NO_EID} from "@/sim/sentinels.js";

/**
 * An Int32Array column indexed by port eid, owned by a module but grown with the Port component.
 * The index replaces {@link column} on growth, so a caller reads it fresh each pass (hoisting it for
 * the body of one loop is fine).
 */
export class PortColumn {

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
 * The ports items flow through: the Port component, the shared edge a producer and its consumer both
 * resolve to, the fluid claims on those edges, and the sweep that destroys the ones nothing
 * references any more. Every column indexed by port eid grows from here, the engine's own and the
 * module-registered ones alike.
 */
export class PortIndex {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        this.engine = engine;

        // Port component: item type per port eid (EMPTY when unoccupied). An edge port also carries
        // Position for the edge it sits on, so the edge index rebuilds from the world; a port with no
        // Position is not an edge port.
        this.def = engine.components.define("Port", [
            {name: "item", fill: EMPTY},
        ]);

        /**
         * The Port columns, indexed by port eid.
         * @type {Object<string, Int32Array>}
         */
        this.Port = this.def.store;

        // Ports belonging to fluid machinery (pipe network and tank edges); belts refuse to link
        // with one. Marked by the owning module, re-marked on rebuild.
        this._fluid = new Uint8Array(this.def.capacity);
        // The fluid type a producer emits into a port (EMPTY for none/solid), so a pipe network
        // adopting the edge binds its type before the first payload. The generation bumps on every
        // write, so an idle consumer re-scans its sources only when one could have changed.
        this._fluidSource = new Int32Array(this.def.capacity).fill(EMPTY);
        this._fluidSourceGeneration = 1;

        // Shared ports by edge key "x,y,direction" — a derived index over Port + Position, rebuilt
        // from the world on deserialize.
        this._byEdge = new Map();

        // Module-owned columns indexed by port eid.
        this._columns = [];

        // Hooks returning the port eids a module still references in JS-only runtime state (belt
        // paths), so the sweep keeps them alive.
        this._pins = [];
    }

    /**
     * The Port component's current column length.
     * @returns {number}
     */
    get capacity() {
        return this.def.capacity;
    }

    /**
     * Grows every port-indexed column kept outside the Port component itself. Registered with the
     * component registry as the Port component's grow listener.
     * @param {number} capacity
     * @returns {void}
     */
    growColumns(capacity) {
        const fluidSource = new Int32Array(capacity).fill(EMPTY);
        fluidSource.set(this._fluidSource);
        this._fluidSource = fluidSource;
        const fluid = new Uint8Array(capacity);
        fluid.set(this._fluid);
        this._fluid = fluid;
        for (const column of this._columns) {
            column.grow(capacity);
        }
        this.engine.transfers.growPortColumns(capacity);
        this.engine.render.growPortColumns(capacity);
    }

    /**
     * Registers a module column indexed by port eid, grown with the Port component. Lets a module
     * index per-port state the way the engine does, instead of keying a Map on port eids.
     * @param {number} [fill] - the value an unwritten port reads as
     * @returns {PortColumn}
     */
    registerColumn(fill=0) {
        const column = new PortColumn(this.def.capacity, fill);
        this._columns.push(column);
        return column;
    }

    /**
     * Creates a port carrying `item` (EMPTY for an empty port).
     * @param {number} [item]
     * @returns {number} the port eid
     */
    create(item=EMPTY) {
        const eid = this.engine.world.addEntity();
        this.engine.components.attach(this.def, eid);
        // The world recycles eids, so clear any shadow/flag the previous tenant left behind.
        this.engine.render.forgetPort(eid);
        this._fluid[eid] = 0;
        this._fluidSource[eid] = EMPTY;
        this.setItem(eid, item);
        return eid;
    }

    /**
     * @param {number} eid
     * @returns {number} the port's item, or EMPTY
     */
    item(eid) {
        return this.Port.item[eid];
    }

    /**
     * @param {number} eid
     * @param {number} item
     * @returns {void}
     */
    setItem(eid, item) {
        if (item === EMPTY && this.Port.item[eid] !== EMPTY) {
            this.engine.render.noteCleared(eid);
        }
        this.Port.item[eid] = item;
        this.engine.render.markDirty(eid);
    }

    /**
     * Empties a port a consumer ate from, so its clear renders as a glide into the consumer.
     * @param {number} eid
     * @returns {void}
     */
    consumeItem(eid) {
        this.Port.item[eid] = EMPTY;
        this.engine.render.noteConsumed(eid);
        this.engine.render.markDirty(eid);
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
    at(x, y, direction) {
        const key = tileVariantId(tileId(x, y), direction);
        let eid = this._byEdge.get(key);
        if (eid === undefined) {
            eid = this.create();
            this.engine.space.setPosition(eid, x, y, direction);
            this._byEdge.set(key, eid);
        }
        return eid;
    }

    /**
     * The existing port on the edge "flow entering tile (x, y) going `direction`", or null —
     * {@link at} without the create, for an emitter that must not strand a payload in a port
     * nothing consumes.
     * @param {number} x
     * @param {number} y
     * @param {number} direction
     * @returns {number|null} the port eid
     */
    peekAt(x, y, direction) {
        const eid = this._byEdge.get(tileVariantId(tileId(x, y), direction));
        if (eid === undefined) {
            return null;
        }
        return eid;
    }

    /**
     * Declares the fluid type a producer emits into `eid` (EMPTY to clear).
     * @param {number} eid
     * @param {number} fluidType
     * @returns {void}
     */
    setFluidSource(eid, fluidType) {
        this._fluidSource[eid] = fluidType;
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
    fluidSource(eid) {
        return this._fluidSource[eid];
    }

    /**
     * Claims a port for fluid machinery (a pipe network edge or tank port); a port may be claimed
     * by more than one owner when a pipe and a tank share an edge, so {@link isFluidClaimed} only
     * clears once every owner has called {@link unmarkFluid}.
     * @param {number} eid
     * @returns {void}
     */
    markFluid(eid) {
        this._fluid[eid] += 1;
    }

    /**
     * Releases one fluid-machinery claim taken by {@link markFluid}.
     * @param {number} eid
     * @returns {void}
     */
    unmarkFluid(eid) {
        this._fluid[eid] -= 1;
    }

    /**
     * @param {number} eid
     * @returns {boolean} whether the port is claimed by any fluid machinery
     */
    isFluidClaimed(eid) {
        return this._fluid[eid] > 0;
    }

    /**
     * A module registers a hook returning the port eids its JS-only runtime state still references
     * (belt paths hold their end ports outside any component), so {@link collectUnreferenced} keeps
     * them.
     * @param {function(): Iterable<number>} hook
     * @returns {void}
     */
    registerPin(hook) {
        this._pins.push(hook);
    }

    /**
     * Destroys every port no live entity or module references: scans all component eid fields (object
     * ports) plus the pin hooks (belt runtime ports), then removes any port outside that set —
     * destroying the edges a deleted object or belt left behind.
     * @returns {void}
     */
    collectUnreferenced() {
        const engine = this.engine;
        const referenced = new Set();
        for (const def of engine.components.defs) {
            if (def.snapshotOnly) {
                continue;
            }
            const eidFields = def.fields.filter(field => field.kind === "eid");
            if (eidFields.length === 0) {
                continue;
            }
            for (const slot of engine.components.slotsOf(def)) {
                for (const field of eidFields) {
                    const target = def.store[field.name][slot];
                    if (target !== NO_EID) {
                        referenced.add(target);
                    }
                }
            }
        }
        for (const hook of this._pins) {
            for (const eid of hook()) {
                referenced.add(eid);
            }
        }

        const doomed = [];
        for (const eid of engine.world.query([this.def.store])) {
            if (!referenced.has(eid)) {
                doomed.push(eid);
            }
        }
        // Before the entities go: the edge key reads their Position, and a port dying with a drawn
        // item owes the client a clear no later diff would send.
        for (const eid of doomed) {
            if (engine.world.hasComponent(eid, engine.space.positionDef.store)) {
                this._byEdge.delete(this._edgeKey(eid));
            }
        }
        engine.render.retirePorts(doomed);
        for (const eid of doomed) {
            engine.world.removeEntity(eid);
        }
    }

    /**
     * Drops the fluid claims and the edge index, then rebuilds the latter from the restored world.
     * @returns {void}
     */
    rebuild() {
        this._fluid.fill(0);
        this._fluidSource.fill(EMPTY);
        this._byEdge = new Map();
        // The edge ports are those carrying Position; a port with none sits on no edge.
        const edgePorts = this.engine.world.query([this.def.store, this.engine.space.positionDef.store]);
        for (const eid of edgePorts) {
            this._byEdge.set(this._edgeKey(eid), eid);
        }
    }

    /**
     * @private
     * @param {number} eid - an edge port
     * @returns {number} its index key
     */
    _edgeKey(eid) {
        const position = this.engine.space.Position;
        return tileVariantId(tileId(position.x[eid], position.y[eid]), position.direction[eid]);
    }
}
