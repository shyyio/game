import {ObjectFieldsEvent, ObjectFieldsBatchEvent} from "@/common/ObjectEvents.js";
import {chunkKeyAt} from "@/common/util.js";

// Initial length of the per-eid dirty flags and shadow columns; grows by doubling.
const INITIAL_CAPACITY = 1024;

/**
 * The synced fields a behavior registered on one component, the rows marked since the last emit,
 * and per eid the values the clients last heard (the shadow the emit diffs against).
 */
class SyncedSet {

    /**
     * @param {AbstractComponent} component
     * @param {SyncedField[]} fields
     */
    constructor(component, fields) {
        this.component = component;
        this.fields = fields;
        this.dirty = [];
        this.isDirty = new Uint8Array(INITIAL_CAPACITY);
        this.shadow = fields.map(field => new Int32Array(INITIAL_CAPACITY).fill(field.defaultValue));
    }

    /**
     * Makes `eid` addressable in the dirty flags and shadow columns.
     * @param {number} eid
     * @returns {void}
     */
    grow(eid) {
        if (eid < this.isDirty.length) {
            return;
        }
        let capacity = this.isDirty.length;
        while (capacity <= eid) {
            capacity *= 2;
        }
        const flags = new Uint8Array(capacity);
        flags.set(this.isDirty);
        this.isDirty = flags;
        for (const [i, field] of this.fields.entries()) {
            const grown = new Int32Array(capacity).fill(field.defaultValue);
            grown.set(this.shadow[i]);
            this.shadow[i] = grown;
        }
    }

    /**
     * @param {number} row
     * @returns {number[]}
     */
    valuesAt(row) {
        return this.fields.map(field => this.component.store[field.name][row]);
    }

    /**
     * Copies a row's values into its eid's shadow.
     * @param {number} eid
     * @param {number[]} values
     * @returns {boolean} whether any differed from the shadow
     */
    adopt(eid, values) {
        let changed = false;
        for (const [i, value] of values.entries()) {
            if (this.shadow[i][eid] !== value) {
                this.shadow[i][eid] = value;
                changed = true;
            }
        }
        return changed;
    }

    /**
     * @param {number} row
     * @returns {boolean}
     */
    offDefault(row) {
        return this.fields.some(field => this.component.store[field.name][row] !== field.defaultValue);
    }
}

/**
 * Mirrors registered component fields to clients: rows a behavior marks batch per chunk at tick
 * end, and chunk sync carries every row off its defaults.
 */
export class FieldSync {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        this.engine = engine;
        /**
         * @type {Map<AbstractComponent, SyncedSet>}
         * @private
         */
        this._sets = new Map();
    }

    /**
     * Registers a behavior's synced fields on a sparse component it does not already have; each
     * field's default must match its component's.
     * @param {AbstractComponent} component
     * @param {SyncedField[]} fields
     * @returns {void}
     */
    register(component, fields) {
        if (!component.sparse) {
            throw new Error(`Synced fields need a sparse component, "${component.name}" is dense`);
        }
        if (this._sets.has(component)) {
            throw new Error(`Component "${component.name}" already has synced fields`);
        }
        for (const field of fields) {
            const defined = component.fields.find(candidate => candidate.name === field.name);
            if (defined === undefined) {
                throw new Error(`Synced field "${field.name}" is not on component "${component.name}"`);
            }
            if (defined.defaultValue !== field.defaultValue) {
                throw new Error(`Synced field "${component.name}.${field.name}" default ${field.defaultValue} differs from the component's ${defined.defaultValue}`);
            }
            // The shadow columns and the wire carry int32; a float would round-trip truncated.
            if (defined.kind === "f32") {
                throw new Error(`Synced field "${component.name}.${field.name}" is f32, which the wire cannot carry`);
            }
            if (field.name === "type" || field.name === "direction") {
                throw new Error(`Synced field "${component.name}.${field.name}" would overwrite the client entry's own data.${field.name}`);
            }
        }
        this._sets.set(component, new SyncedSet(component, fields));
    }

    /**
     * Queues a row whose synced fields changed for the next emit.
     * @param {AbstractComponent} component
     * @param {number} eid
     * @returns {void}
     */
    markDirty(component, eid) {
        const set = this._set(component);
        set.grow(eid);
        if (set.isDirty[eid] === 1) {
            return;
        }
        set.isDirty[eid] = 1;
        set.dirty.push(eid);
    }

    /**
     * Resets a freshly spawned row's shadow to the defaults the client assumes, and queues it when it
     * starts off them.
     * @param {AbstractComponent} component
     * @param {number} eid
     * @returns {void}
     */
    markSpawned(component, eid) {
        const set = this._set(component);
        set.grow(eid);
        set.adopt(eid, set.fields.map(field => field.defaultValue));
        if (set.offDefault(component.row(eid))) {
            this.markDirty(component, eid);
        }
    }

    /**
     * One row's current values as a single event, for a corrective send to one session.
     * @param {AbstractComponent} component
     * @param {number} eid
     * @returns {ObjectFieldsEvent}
     */
    eventFor(component, eid) {
        const set = this._set(component);
        const position = this.engine.Position;
        return new ObjectFieldsEvent(this.engine.placed.objectRefOf(eid), position.x[eid], position.y[eid], set.valuesAt(component.row(eid)));
    }

    /**
     * EMIT_RENDER: one batch per chunk per set of the marked rows still alive whose values moved
     * off their shadow, to observed chunks. The shadow follows whether or not anyone watched: a later
     * subscriber gets the state through chunk sync.
     * @returns {void}
     */
    emit() {
        const position = this.engine.Position;
        const placed = this.engine.placed;
        for (const set of this._sets.values()) {
            if (set.dirty.length === 0) {
                continue;
            }
            const batches = new Map();
            for (const eid of set.dirty) {
                set.isDirty[eid] = 0;
                const row = set.component.row(eid);
                if (row < 0) {
                    continue;
                }
                const values = set.valuesAt(row);
                if (!set.adopt(eid, values)) {
                    continue;
                }
                const x = position.x[eid];
                const y = position.y[eid];
                if (!this.engine.observesTile(x, y)) {
                    continue;
                }
                const chunkKey = chunkKeyAt(x, y);
                let batch = batches.get(chunkKey);
                if (batch === undefined) {
                    batch = new ObjectFieldsBatchEvent(x, y, set.fields.length);
                    batches.set(chunkKey, batch);
                }
                batch.add(placed.objectRefOf(eid), values);
            }
            set.dirty.length = 0;
            for (const batch of batches.values()) {
                this.engine.emitEvent(batch);
            }
        }
    }

    /**
     * The chunk's placed rows off their defaults, one batch per set.
     * @param {number} chunkKey
     * @returns {ObjectFieldsBatchEvent[]}
     */
    chunkSync(chunkKey) {
        const position = this.engine.Position;
        const placed = this.engine.placed;
        const events = [];
        const eids = placed.eidsInChunk(chunkKey);
        for (const set of this._sets.values()) {
            let batch = null;
            for (const eid of eids) {
                const row = set.component.row(eid);
                if (row < 0 || !set.offDefault(row)) {
                    continue;
                }
                if (batch === null) {
                    batch = new ObjectFieldsBatchEvent(position.x[eid], position.y[eid], set.fields.length);
                }
                batch.add(placed.objectRefOf(eid), set.valuesAt(row));
            }
            if (batch !== null) {
                events.push(batch);
            }
        }
        return events;
    }

    /**
     * Drops every pending mark, for a world being replaced by a load.
     * @returns {void}
     */
    reset() {
        for (const set of this._sets.values()) {
            set.isDirty.fill(0);
            set.dirty.length = 0;
        }
    }

    /**
     * Rebuild hook: every loaded row's shadow takes its values, which chunk sync hands each client.
     * @returns {void}
     */
    rebuild() {
        for (const set of this._sets.values()) {
            const component = set.component;
            for (let row = 0; row < component.count; row += 1) {
                const eid = component.eids[row];
                set.grow(eid);
                set.adopt(eid, set.valuesAt(row));
            }
        }
    }

    /**
     * @private
     * @param {AbstractComponent} component
     * @returns {SyncedSet}
     */
    _set(component) {
        const set = this._sets.get(component);
        if (set === undefined) {
            throw new Error(`No synced fields registered on component "${component.name}"`);
        }
        return set;
    }
}
