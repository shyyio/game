/**
 * A read-only view over a Set.
 * @template T
 */
export class FrozenSet {

    /**
     * @param {Set<T>} set
     */
    constructor(set) {
        this._set = set;
    }

    /**
     * @returns {number}
     */
    get size() {
        return this._set.size;
    }

    /**
     * @param {T} value
     * @returns {boolean}
     */
    has(value) {
        return this._set.has(value);
    }

    /**
     * @returns {Iterator<T>}
     */
    [Symbol.iterator]() {
        return this._set.values();
    }
}
