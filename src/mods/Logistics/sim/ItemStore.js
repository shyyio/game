// Initial arena size in item slots; grows by doubling.
const ARENA_CAPACITY = 4096;


/**
 * The in-flight items of every belt path, in three shared public columns the move loop indexes
 * directly (avoiding a dependent cache miss per path per tick); each path owns a fixed
 * `length`-slot slab used as a ring. An item's `gap` is the empty half-tiles ahead of it (the lead
 * item's distance from the output edge): decrementing one gap advances it and everything behind
 * it, and popping the lead leaves the next one's stored gap already correct.
 */
export class ItemStore {

    constructor() {
        this.capacity = ARENA_CAPACITY;
        this.ids = new Float64Array(ARENA_CAPACITY);
        this.types = new Int32Array(ARENA_CAPACITY);
        this.gaps = new Int32Array(ARENA_CAPACITY);
        // Bump pointer plus freed slabs keyed by exact size; path lengths repeat, so exact-size reuse curbs arena growth.
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
     * Returns a slab for reuse; contents are left for the next taker to overwrite.
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
