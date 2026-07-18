// Initial arena size in item slots; grows by doubling.
const ARENA_CAPACITY = 4096;


/**
 * The in-flight items of every belt path, in three shared columns.
 *
 * Each path owns a fixed slab of `length` slots (a path can never hold more items than it has
 * half-tiles), used as a ring. The columns are public: the move loop indexes them directly, since
 * going through the path object and a per-path items object costs a dependent cache miss per path
 * per tick, which is what the per-path typed columns exist to avoid.
 *
 * An item's `gap` is the empty half-tiles ahead of it (for the lead item, its distance from the
 * output edge). Positions are therefore relative: decrementing one item's gap advances it and
 * everything behind it by a half-tile, and popping the lead item leaves the next one's stored gap
 * already correct. So a tick moves a path with two integer writes whatever it carries.
 */
export class ItemStore {

    constructor() {
        this.capacity = ARENA_CAPACITY;
        this.ids = new Float64Array(ARENA_CAPACITY);
        this.types = new Int32Array(ARENA_CAPACITY);
        this.gaps = new Int32Array(ARENA_CAPACITY);
        // Bump pointer for never-yet-allocated space, and freed slabs keyed by their exact size. Path
        // lengths repeat heavily, so exact-size reuse keeps the arena from growing on every edit.
        this._used = 0;
        this._freeBySlots = new Map();
    }

    /**
     * Reserves a slab of `slots` contiguous item slots.
     * @param {number} slots
     * @returns {number} the slab's base index into the columns
     */
    allocate(slots) {
        const free = this._freeBySlots.get(slots);
        if (free !== undefined && free.length > 0) {
            return free.pop();
        }
        this._reserve(this._used + slots);
        const base = this._used;
        this._used += slots;
        return base;
    }

    /**
     * Returns a slab for reuse. Its contents are left as they are; whoever takes it next overwrites
     * the slots it fills.
     * @param {number} base
     * @param {number} slots
     * @returns {void}
     */
    free(base, slots) {
        const free = this._freeBySlots.get(slots);
        if (free === undefined) {
            this._freeBySlots.set(slots, [base]);
            return;
        }
        free.push(base);
    }

    /**
     * Grows the columns so `needed` slots fit, carrying the live slabs across.
     * @private
     * @param {number} needed
     * @returns {void}
     */
    _reserve(needed) {
        if (needed <= this.capacity) {
            return;
        }
        let capacity = this.capacity;
        while (capacity < needed) {
            capacity *= 2;
        }
        const ids = new Float64Array(capacity);
        ids.set(this.ids);
        this.ids = ids;
        for (const name of ["types", "gaps"]) {
            const grown = new Int32Array(capacity);
            grown.set(this[name]);
            this[name] = grown;
        }
        this.capacity = capacity;
    }
}
