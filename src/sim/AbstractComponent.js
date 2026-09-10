// Initial column length for every component; grows by doubling when a slot exceeds it.
const INITIAL_CAPACITY = 1024;

// Column slot for a row a sparse component does not hold.
const NO_ROW = -1;

/**
 * A component column for a field kind: Float32Array for "f32", Int32Array otherwise ("i32"/"eid").
 * @param {string} kind
 * @param {number} capacity
 * @param {number} defaultValue
 * @returns {Int32Array|Float32Array}
 */
function columnFor(kind, capacity, defaultValue) {
    const column = kind === "f32" ? new Float32Array(capacity) : new Int32Array(capacity);
    return column.fill(defaultValue);
}

/**
 * A component: its SoA typed-array columns plus how they are indexed. A subclass names itself and
 * its fields in its constructor and carries the helpers over its rows.
 *
 * A dense component's columns are indexed by eid and sized to the whole eid range — right for
 * components nearly every entity carries (Position, Port). A sparse one's are indexed by a row
 * number and sized to how many entities actually carry it, so a component held by a small slice of
 * the world costs a small slice of the memory. Rows come from the world's membership set, and a
 * removal swaps the last row down into the freed slot, so row numbers are stable only within a tick.
 */
export class AbstractComponent {

    /**
     * `fieldSpecs` are {name, kind?, defaultValue?} — kind "eid" marks an entity-reference column
     * remapped on deserialize, "type" an object objectTypeId and "item" an item type (both carried
     * over when the loadout changes), "f32" a float column (default "i32"); defaultValue is what an
     * unwritten slot holds (default 0).
     * @param {string} name
     * @param {{name:string, kind?:string, defaultValue?:number}[]} fieldSpecs
     * @param {{snapshotOnly?:boolean, sparse?:boolean}} [options] - snapshotOnly components hold
     *     state materialized at save (pipe networks), not kept in sync during play, so the port
     *     sweep ignores their eid fields (the module's live pin hook is authoritative instead);
     *     sparse components index their columns by row instead of by eid
     */
    constructor(name, fieldSpecs, {snapshotOnly=false, sparse=false}={}) {
        this.name = name;
        this.fields = fieldSpecs.map(spec => {
            let kind = spec.kind;
            if (kind === undefined) {
                kind = "i32";
            }
            let defaultValue = spec.defaultValue;
            if (defaultValue === undefined) {
                defaultValue = 0;
            }
            return {name: spec.name, kind, defaultValue};
        });
        this.snapshotOnly = snapshotOnly;
        this.sparse = sparse;
        this.capacity = INITIAL_CAPACITY;
        /**
         * Column per field, indexed by {@link slot}.
         * @type {Object<string, Int32Array|Float32Array>}
         */
        this.store = {};
        for (const field of this.fields) {
            this.store[field.name] = columnFor(field.kind, INITIAL_CAPACITY, field.defaultValue);
        }

        /**
         * The world's membership set, adopted as row numbering; null for a dense component.
         * @type {?ComponentSet}
         */
        this.set = null;

        /**
         * The world the component is bound to; null until {@link bind}.
         * @type {?World}
         */
        this.world = null;

        /**
         * Run with the new capacity when the columns grow, so state kept outside the component grows
         * with it; null for none.
         * @type {?function(number): void}
         */
        this.growListener = null;
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

    /**
     * Adopts `world`'s membership set as a sparse component's row numbering.
     * @param {World} world
     * @returns {void}
     */
    bind(world) {
        this.world = world;
        if (!this.sparse) {
            return;
        }
        this.set = world.trackRows(this.store, (fromRow, toRow) => {
            for (const field of this.fields) {
                const column = this.store[field.name];
                column[toRow] = column[fromRow];
            }
        });
    }

    /**
     * Resets every column to its default values.
     * @returns {void}
     */
    clear() {
        for (const field of this.fields) {
            this.store[field.name].fill(field.defaultValue);
        }
    }

    /**
     * Grows the columns so `slot` is addressable.
     * @param {number} slot - an eid when dense, a row when sparse
     * @returns {void}
     */
    grow(slot) {
        if (slot < this.capacity) {
            return;
        }
        let capacity = this.capacity;
        while (capacity <= slot) {
            capacity *= 2;
        }
        for (const field of this.fields) {
            const grown = columnFor(field.kind, capacity, field.defaultValue);
            grown.set(this.store[field.name]);
            this.store[field.name] = grown;
        }
        this.capacity = capacity;
        if (this.growListener !== null) {
            this.growListener(capacity);
        }
    }

    /**
     * Attaches the component to an entity, growing the columns first. A sparse component's new row
     * is cleared, since a prior tenant's values may still sit there.
     * @param {number} eid
     * @returns {void}
     */
    attach(eid) {
        if (!this.sparse) {
            this.grow(eid);
            this.world.addComponent(eid, this.store);
            return;
        }
        this.world.addComponent(eid, this.store);
        const row = this.row(eid);
        this.grow(row);
        for (const field of this.fields) {
            this.store[field.name][row] = field.defaultValue;
        }
    }

    /**
     * Creates an entity carrying this component.
     * @returns {number} the entity id
     */
    create() {
        const eid = this.world.addEntity();
        this.attach(eid);
        return eid;
    }

    /**
     * Removes an entity (and all its components) from the world; a no-op for an already-destroyed
     * eid.
     * @param {number} eid
     * @returns {void}
     */
    destroy(eid) {
        if (this.world.entityExists(eid)) {
            this.world.removeEntity(eid);
        }
    }

    /**
     * The entities currently carrying this component.
     * @returns {Int32Array}
     */
    entities() {
        if (this.sparse) {
            return this.eids.slice(0, this.count);
        }
        return this.world.query([this.store]);
    }

    /**
     * Every live slot of the columns: rows when sparse, entity ids when dense. Lets the generic
     * passes (the port sweep, serialize) read any component without knowing which it is.
     * @returns {Int32Array}
     */
    slots() {
        if (!this.sparse) {
            return this.world.query([this.store]);
        }
        const slots = new Int32Array(this.count);
        for (let row = 0; row < this.count; row += 1) {
            slots[row] = row;
        }
        return slots;
    }
}
