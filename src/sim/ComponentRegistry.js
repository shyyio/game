// Initial column length for every component; grows by doubling when a slot exceeds it.
const INITIAL_CAPACITY = 1024;

// Column slot for a row a sparse component does not hold.
const NO_ROW = -1;

/**
 * A component column for a field kind: Float32Array for "f32", Int32Array otherwise ("i32"/"eid").
 * @param {string} kind
 * @param {number} capacity
 * @param {number} fill
 * @returns {Int32Array|Float32Array}
 */
function columnFor(kind, capacity, fill) {
    const column = kind === "f32" ? new Float32Array(capacity) : new Int32Array(capacity);
    return column.fill(fill);
}

/**
 * A registered component: its SoA typed-array columns plus how they are indexed.
 *
 * A dense component's columns are indexed by eid and sized to the whole eid range — right for
 * components nearly every entity carries (Position, Port). A sparse one's are indexed by a row
 * number and sized to how many entities actually carry it, so a component held by a small slice of
 * the world costs a small slice of the memory. Rows come from the world's membership set, and a
 * removal swaps the last row down into the freed slot, so row numbers are stable only within a tick.
 */
export class ComponentDef {

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
        this.capacity = INITIAL_CAPACITY;
        /**
         * Column per field, indexed by {@link slot}.
         * @type {Object<string, Int32Array|Float32Array>}
         */
        this.store = {};
        for (const field of fields) {
            this.store[field.name] = columnFor(field.kind, INITIAL_CAPACITY, field.fill);
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
        if (eid < this.set.sparse.length) {
            return this.set.sparse[eid];
        }
        return NO_ROW;
    }

    /**
     * The slot `eid`'s values live at: its row when sparse, the eid itself when dense.
     * @param {number} eid
     * @returns {number}
     */
    slot(eid) {
        if (this.sparse) {
            return this.row(eid);
        }
        return eid;
    }

    /**
     * The entity whose values live at `slot`.
     * @param {number} slot
     * @returns {number}
     */
    eidAt(slot) {
        if (this.sparse) {
            return this.set.dense[slot];
        }
        return slot;
    }
}

/**
 * Every {@link ComponentDef} a loadout registers, in definition order, plus the entity operations
 * that attach them and the doubling growth of their columns. The generic serializer walks these
 * defs, so any state a module keeps in a component round-trips with no bespoke save code.
 */
export class ComponentRegistry {

    /**
     * @param {GameEngine} engine - for the world the entities live in
     */
    constructor(engine) {
        this.engine = engine;

        /**
         * Registered components in definition order.
         * @type {ComponentDef[]}
         */
        this.defs = [];

        /**
         * @type {Map<string, ComponentDef>}
         * @private
         */
        this._byName = new Map();

        // Run with the new capacity when a component's columns grow, so port-indexed state kept
        // outside the component grows with it.
        this._growListeners = new Map();
    }

    /**
     * Registers a component: SoA typed-array columns grown by doubling, tracked for generic
     * serialization. `fields` are {name, kind?, fill?} — kind "eid" marks an entity-reference column
     * remapped on deserialize, "type" an object typeId and "item" an item type (both carried over
     * when the loadout changes), "f32" a float column (default "i32"); fill is the empty-slot value
     * (default 0). Modules call this so their state round-trips with no bespoke save code.
     * @param {string} name
     * @param {{name:string, kind?:string, fill?:number}[]} fieldSpecs
     * @param {{snapshotOnly?:boolean, sparse?:boolean}} [options] - snapshotOnly components hold state
     *     materialized at save (belt paths), not kept in sync during play, so the port sweep ignores
     *     their eid fields (the module's live pin hook is authoritative instead); sparse components
     *     index their columns by row instead of by eid, so a component only a slice of the world
     *     carries is sized to that slice (see {@link ComponentDef})
     * @returns {ComponentDef}
     */
    define(name, fieldSpecs, {snapshotOnly=false, sparse=false}={}) {
        const fields = fieldSpecs.map(spec => {
            let kind = spec.kind;
            if (kind === undefined) {
                kind = "i32";
            }
            let fill = spec.fill;
            if (fill === undefined) {
                fill = 0;
            }
            return {name: spec.name, kind, fill};
        });
        const def = new ComponentDef(name, fields, snapshotOnly, sparse);
        this.defs.push(def);
        this._byName.set(name, def);
        if (this.engine.world !== null) {
            this.bind(def);
        }
        return def;
    }

    /**
     * The component registered under `name`; throws on an unknown name.
     * @param {string} name
     * @returns {ComponentDef}
     */
    get(name) {
        const def = this._byName.get(name);
        if (def === undefined) {
            throw new Error(`Unknown component "${name}"`);
        }
        return def;
    }

    /**
     * The component registered under `name`, or undefined — the tolerant twin of {@link get}, for
     * the save checks that report a drifted component instead of throwing on it.
     * @param {string} name
     * @returns {ComponentDef|undefined}
     */
    find(name) {
        return this._byName.get(name);
    }

    /**
     * Registers the listener run with the new capacity whenever `def`'s columns grow.
     * @param {ComponentDef} def
     * @param {function(number): void} listener
     * @returns {void}
     */
    onGrow(def, listener) {
        this._growListeners.set(def, listener);
    }

    /**
     * Adopts the world's membership set as a sparse component's row numbering.
     * @param {ComponentDef} def
     * @returns {void}
     */
    bind(def) {
        if (!def.sparse) {
            return;
        }
        def.set = this.engine.world.trackRows(def.store, (fromRow, toRow) => {
            for (const field of def.fields) {
                const column = def.store[field.name];
                column[toRow] = column[fromRow];
            }
        });
    }

    /**
     * Binds every registered component to the current world; the components outlive it, so this runs
     * again for each new one.
     * @returns {void}
     */
    bindAll() {
        for (const def of this.defs) {
            this.bind(def);
        }
    }

    /**
     * Resets every registered component's columns to their fill values.
     * @returns {void}
     */
    clearAll() {
        for (const def of this.defs) {
            for (const field of def.fields) {
                def.store[field.name].fill(field.fill);
            }
        }
    }

    /**
     * Grows a component's columns so `slot` is addressable.
     * @param {ComponentDef} def
     * @param {number} slot - an eid when dense, a row when sparse
     * @returns {void}
     */
    grow(def, slot) {
        if (slot < def.capacity) {
            return;
        }
        let capacity = def.capacity;
        while (capacity <= slot) {
            capacity *= 2;
        }
        for (const field of def.fields) {
            const grown = columnFor(field.kind, capacity, field.fill);
            grown.set(def.store[field.name]);
            def.store[field.name] = grown;
        }
        def.capacity = capacity;
        const listener = this._growListeners.get(def);
        if (listener !== undefined) {
            listener(capacity);
        }
    }

    /**
     * Attaches a component to an entity, growing its columns first. A sparse component's new row is
     * cleared, since a prior tenant's values may still sit there.
     * @param {ComponentDef} def
     * @param {number} eid
     * @returns {void}
     */
    attach(def, eid) {
        const world = this.engine.world;
        if (!def.sparse) {
            this.grow(def, eid);
            world.addComponent(eid, def.store);
            return;
        }
        world.addComponent(eid, def.store);
        const row = def.row(eid);
        this.grow(def, row);
        for (const field of def.fields) {
            def.store[field.name][row] = field.fill;
        }
    }

    /**
     * Creates an entity carrying `def`'s component.
     * @param {ComponentDef} def
     * @returns {number} the entity id
     */
    createEntity(def) {
        const eid = this.engine.world.addEntity();
        this.attach(def, eid);
        return eid;
    }

    /**
     * Removes an entity (and all its components) from the world; a no-op for an already-destroyed eid.
     * @param {number} eid
     * @returns {void}
     */
    destroyEntity(eid) {
        if (this.engine.world.entityExists(eid)) {
            this.engine.world.removeEntity(eid);
        }
    }

    /**
     * The entities currently carrying `def`'s component.
     * @param {ComponentDef} def
     * @returns {Int32Array}
     */
    entitiesWith(def) {
        if (def.sparse) {
            return def.eids.slice(0, def.count);
        }
        return this.engine.world.query([def.store]);
    }

    /**
     * Every live slot of `def`'s columns: its rows when sparse, its entity ids when dense. Lets the
     * generic passes (the port sweep, serialize) read any component without knowing which it is.
     * @param {ComponentDef} def
     * @returns {Int32Array}
     */
    slotsOf(def) {
        if (!def.sparse) {
            return this.engine.world.query([def.store]);
        }
        const slots = new Int32Array(def.count);
        for (let row = 0; row < def.count; row += 1) {
            slots[row] = row;
        }
        return slots;
    }
}
