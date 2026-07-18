// Entity ids and component membership. Component *data* lives in the caller's own SoA columns
// (see GameEngine.defineComponent), so a world only answers "which entities carry which component".

// Entity ids and per-component sparse sets grow by doubling from here.
const INITIAL_CAPACITY = 1024;

const BITS_PER_MASK = 32;

// eid 0 stays unused, so a falsy eid is never a live entity.
const FIRST_EID = 1;

// Sparse-set slot for an entity the set does not hold.
const NOT_IN_SET = -1;

/**
 * A component's membership set: dense eids for iteration, sparse eid -> dense slot for O(1) removal.
 */
class ComponentSet {

    /**
     * @param {number} capacity - eid capacity the sparse column must cover
     */
    constructor(capacity) {
        this.dense = new Int32Array(INITIAL_CAPACITY);
        this.count = 0;
        this.sparse = new Int32Array(capacity).fill(NOT_IN_SET);
    }

    /**
     * @param {number} eid
     * @returns {void}
     */
    add(eid) {
        if (this.sparse[eid] !== NOT_IN_SET) {
            return;
        }
        if (this.count === this.dense.length) {
            const grown = new Int32Array(this.dense.length * 2);
            grown.set(this.dense);
            this.dense = grown;
        }
        this.dense[this.count] = eid;
        this.sparse[eid] = this.count;
        this.count += 1;
    }

    /**
     * @param {number} eid
     * @returns {void}
     */
    remove(eid) {
        const slot = this.sparse[eid];
        if (slot === NOT_IN_SET) {
            return;
        }
        this.count -= 1;
        const moved = this.dense[this.count];
        this.dense[slot] = moved;
        this.sparse[moved] = slot;
        this.sparse[eid] = NOT_IN_SET;
    }

    /**
     * @param {number} capacity
     * @returns {void}
     */
    grow(capacity) {
        const grown = new Int32Array(capacity).fill(NOT_IN_SET);
        grown.set(this.sparse);
        this.sparse = grown;
    }
}

/**
 * The entity world: id allocation plus component membership.
 */
export class World {

    constructor() {

        /**
         * Addressable eid range of {@link _alive}, the masks and every sparse column.
         * @private
         * @type {number}
         */
        this._capacity = INITIAL_CAPACITY;

        /**
         * @private
         * @type {Uint8Array}
         */
        this._alive = new Uint8Array(INITIAL_CAPACITY);

        /**
         * @private
         * @type {number}
         */
        this._nextEid = FIRST_EID;

        /**
         * Destroyed eids, reused before {@link _nextEid} advances so the range stays dense.
         * @private
         * @type {number[]}
         */
        this._freeEids = [];

        /**
         * One Uint32Array per 32 registered components, indexed by eid.
         * @private
         * @type {Uint32Array[]}
         */
        this._masks = [];

        /**
         * @private
         * @type {Map<object, number>}
         */
        this._componentIds = new Map();

        /**
         * Membership sets by component id, built on the component's first query.
         * @private
         * @type {(ComponentSet|null)[]}
         */
        this._sets = [];
    }

    /**
     * @returns {number} the new entity id
     */
    addEntity() {
        if (this._freeEids.length > 0) {
            const recycled = this._freeEids.pop();
            this._alive[recycled] = 1;
            return recycled;
        }
        const eid = this._nextEid;
        this._nextEid += 1;
        if (eid >= this._capacity) {
            this._grow(eid);
        }
        this._alive[eid] = 1;
        return eid;
    }

    /**
     * Destroys an entity and drops it from every component it carried.
     * @param {number} eid
     * @returns {void}
     */
    removeEntity(eid) {
        if (this._alive[eid] !== 1) {
            return;
        }
        for (let generation = 0; generation < this._masks.length; generation += 1) {
            let mask = this._masks[generation][eid];
            if (mask === 0) {
                continue;
            }
            this._masks[generation][eid] = 0;
            while (mask !== 0) {
                const bit = 31 - Math.clz32(mask & -mask);
                const set = this._sets[generation * BITS_PER_MASK + bit];
                if (set !== null) {
                    set.remove(eid);
                }
                mask &= mask - 1;
            }
        }
        this._alive[eid] = 0;
        this._freeEids.push(eid);
    }

    /**
     * @param {number} eid
     * @returns {boolean}
     */
    entityExists(eid) {
        return eid < this._capacity && this._alive[eid] === 1;
    }

    /**
     * @param {number} eid
     * @param {object} component - any object, used as the component's identity
     * @returns {void}
     */
    addComponent(eid, component) {
        if (this._alive[eid] !== 1) {
            throw new Error(`Cannot add a component to dead entity ${eid}`);
        }
        const id = this._componentId(component);
        const generation = Math.floor(id / BITS_PER_MASK);
        const bit = 1 << (id % BITS_PER_MASK);
        if ((this._masks[generation][eid] & bit) !== 0) {
            return;
        }
        this._masks[generation][eid] |= bit;
        const set = this._sets[id];
        if (set !== null) {
            set.add(eid);
        }
    }

    /**
     * @param {number} eid
     * @param {object} component
     * @returns {boolean}
     */
    hasComponent(eid, component) {
        const id = this._componentIds.get(component);
        if (id === undefined || eid >= this._capacity) {
            return false;
        }
        const generation = Math.floor(id / BITS_PER_MASK);
        return (this._masks[generation][eid] & (1 << (id % BITS_PER_MASK))) !== 0;
    }

    /**
     * The entities carrying every listed component.
     * @param {object[]} components
     * @returns {Int32Array} a snapshot, so callers may destroy entities while iterating it
     */
    query(components) {
        const ids = components.map(component => this._componentId(component));
        let smallest = this._componentSet(ids[0]);
        for (const id of ids) {
            const set = this._componentSet(id);
            if (set.count < smallest.count) {
                smallest = set;
            }
        }

        const result = new Int32Array(smallest.count);
        let found = 0;
        for (let i = 0; i < smallest.count; i += 1) {
            const eid = smallest.dense[i];
            let matches = true;
            for (const id of ids) {
                const generation = Math.floor(id / BITS_PER_MASK);
                if ((this._masks[generation][eid] & (1 << (id % BITS_PER_MASK))) === 0) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                result[found] = eid;
                found += 1;
            }
        }
        return found === result.length ? result : result.subarray(0, found);
    }

    /**
     * The component's id, registering it on first use.
     * @private
     * @param {object} component
     * @returns {number}
     */
    _componentId(component) {
        const known = this._componentIds.get(component);
        if (known !== undefined) {
            return known;
        }
        const id = this._componentIds.size;
        this._componentIds.set(component, id);
        this._sets.push(null);
        if (id % BITS_PER_MASK === 0) {
            this._masks.push(new Uint32Array(this._capacity));
        }
        return id;
    }

    /**
     * The component's membership set, built from the masks on first query.
     * @private
     * @param {number} id
     * @returns {ComponentSet}
     */
    _componentSet(id) {
        const known = this._sets[id];
        if (known !== null) {
            return known;
        }
        const set = new ComponentSet(this._capacity);
        const generation = Math.floor(id / BITS_PER_MASK);
        const bit = 1 << (id % BITS_PER_MASK);
        const mask = this._masks[generation];
        for (let eid = FIRST_EID; eid < this._nextEid; eid += 1) {
            if (this._alive[eid] === 1 && (mask[eid] & bit) !== 0) {
                set.add(eid);
            }
        }
        this._sets[id] = set;
        return set;
    }

    /**
     * Grows every eid-indexed column so `eid` is addressable.
     * @private
     * @param {number} eid
     * @returns {void}
     */
    _grow(eid) {
        let capacity = this._capacity;
        while (capacity <= eid) {
            capacity *= 2;
        }
        const alive = new Uint8Array(capacity);
        alive.set(this._alive);
        this._alive = alive;
        for (let generation = 0; generation < this._masks.length; generation += 1) {
            const grown = new Uint32Array(capacity);
            grown.set(this._masks[generation]);
            this._masks[generation] = grown;
        }
        for (const set of this._sets) {
            if (set !== null) {
                set.grow(capacity);
            }
        }
        this._capacity = capacity;
    }
}
