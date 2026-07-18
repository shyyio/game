// Initial item slots per ring; grows by doubling. Power of two, so the wrap is a mask.
const RING_CAPACITY = 8;


/**
 * A belt path's in-flight items as a ring of typed columns, ordered output edge -> input edge.
 *
 * Each item stores `gap`, the empty half-tiles ahead of it (for the lead item, its distance from the
 * output edge). Positions are therefore relative: decrementing one item's gap advances it and
 * everything behind it by a half-tile, and popping the lead item leaves the next one's stored gap
 * already correct. So a tick moves a path with two integer writes whatever it carries.
 */
export class ItemRing {

    constructor() {
        this._capacity = RING_CAPACITY;
        this._mask = RING_CAPACITY - 1;
        this._ids = new Float64Array(RING_CAPACITY);
        this._types = new Int32Array(RING_CAPACITY);
        this._gaps = new Int32Array(RING_CAPACITY);
        this._head = 0;
        this.count = 0;
    }

    /**
     * A ring of the given items, ordered output edge -> input edge.
     * @param {{id:number, type:number, gap:number}[]} items
     * @returns {ItemRing}
     */
    static from(items) {
        const ring = new ItemRing();
        for (const item of items) {
            ring.push(item.id, item.type, item.gap);
        }
        return ring;
    }

    /**
     * @private
     * @param {number} index
     * @returns {number} the backing column slot holding item `index`
     */
    _slot(index) {
        return (this._head + index) & this._mask;
    }

    /**
     * @param {number} index
     * @returns {number}
     */
    idAt(index) {
        return this._ids[(this._head + index) & this._mask];
    }

    /**
     * @param {number} index
     * @returns {number}
     */
    typeAt(index) {
        return this._types[(this._head + index) & this._mask];
    }

    /**
     * @param {number} index
     * @returns {number}
     */
    gapAt(index) {
        return this._gaps[(this._head + index) & this._mask];
    }

    /**
     * @param {number} index
     * @param {number} gap
     * @returns {void}
     */
    setGapAt(index, gap) {
        this._gaps[(this._head + index) & this._mask] = gap;
    }

    /**
     * Appends an item at the input edge.
     * @param {number} id
     * @param {number} type
     * @param {number} gap
     * @returns {void}
     */
    push(id, type, gap) {
        this._grow();
        const slot = (this._head + this.count) & this._mask;
        this._ids[slot] = id;
        this._types[slot] = type;
        this._gaps[slot] = gap;
        this.count += 1;
    }

    /**
     * Drops the lead (output-edge) item.
     * @returns {void}
     */
    shift() {
        this._head = (this._head + 1) & this._mask;
        this.count -= 1;
    }

    /**
     * The index of the first item at or after `from` with empty space ahead of it, or -1. This is the
     * gap a stalled path compresses into; it only ever walks forward, so the scan is amortized O(1).
     * @param {number} [from]
     * @returns {number}
     */
    firstPositiveGap(from=0) {
        for (let index = from; index < this.count; index += 1) {
            if (this._gaps[(this._head + index) & this._mask] > 0) {
                return index;
            }
        }
        return -1;
    }

    /**
     * The items output edge -> input edge, for the edit paths that rebuild a ring.
     * @returns {{id:number, type:number, gap:number}[]}
     */
    toList() {
        const items = [];
        for (let index = 0; index < this.count; index += 1) {
            const slot = (this._head + index) & this._mask;
            items.push({id: this._ids[slot], type: this._types[slot], gap: this._gaps[slot]});
        }
        return items;
    }

    /**
     * Doubles the columns when full, unrolling the ring so index 0 sits at slot 0.
     * @private
     * @returns {void}
     */
    _grow() {
        if (this.count < this._capacity) {
            return;
        }
        const capacity = this._capacity * 2;
        const ids = new Float64Array(capacity);
        const types = new Int32Array(capacity);
        const gaps = new Int32Array(capacity);
        for (let index = 0; index < this.count; index += 1) {
            const slot = (this._head + index) & this._mask;
            ids[index] = this._ids[slot];
            types[index] = this._types[slot];
            gaps[index] = this._gaps[slot];
        }
        this._ids = ids;
        this._types = types;
        this._gaps = gaps;
        this._head = 0;
        this._capacity = capacity;
        this._mask = capacity - 1;
    }
}
