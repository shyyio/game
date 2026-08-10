/**
 * A {@link DisplayPool} whose live objects are indexed by key: take binds a pooled object to its
 * key, release by key parks it again.
 */
export class KeyedDisplayPool {

    /**
     * @param {DisplayPool} pool
     */
    constructor(pool) {
        this._pool = pool;
        this._live = new Map();
    }

    /**
     * @returns {number}
     */
    get size() {
        return this._live.size;
    }

    /**
     * @param {number|string} key
     * @returns {boolean}
     */
    has(key) {
        return this._live.has(key);
    }

    /**
     * The live object under a key, or undefined.
     * @param {number|string} key
     * @returns {*}
     */
    get(key) {
        return this._live.get(key);
    }

    /**
     * @returns {IterableIterator<*>} the live objects
     */
    values() {
        return this._live.values();
    }

    /**
     * The live object under the key, or a pooled/fresh one bound to it.
     * @param {number|string} key
     * @param {...*} args
     * @returns {*}
     */
    take(key, ...args) {
        let object = this._live.get(key);
        if (object === undefined) {
            object = this._pool.take(...args);
            this._live.set(key, object);
        }
        return object;
    }

    /**
     * Rebinds a live object to a new key, releasing the key's previous occupant; a no-op for an
     * unknown source key.
     * @param {number|string} oldKey
     * @param {number|string} newKey
     * @returns {void}
     */
    rename(oldKey, newKey) {
        const object = this._live.get(oldKey);
        if (object === undefined) {
            return;
        }
        const existing = this._live.get(newKey);
        if (existing !== undefined && existing !== object) {
            this._pool.release(existing);
        }
        this._live.delete(oldKey);
        this._live.set(newKey, object);
    }

    /**
     * Releases a key's object back to the pool; a no-op for an unknown key.
     * @param {number|string} key
     * @returns {void}
     */
    release(key) {
        const object = this._live.get(key);
        if (object === undefined) {
            return;
        }
        this._pool.release(object);
        this._live.delete(key);
    }
}
