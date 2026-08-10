// Uncapped pools hold their high-water mark forever; pass a capacity where that matters.
const UNBOUNDED = Infinity;

/**
 * Recycles display objects a layer would otherwise churn: park makes a released object inert,
 * revive readies a pooled one for reuse, and releases beyond capacity destroy instead of parking.
 */
export class DisplayPool {

    /**
     * @param {function(...*): *} create builds a new object when the pool is dry
     * @param {function(*): void} park makes a released object inert
     * @param {function(*, ...*): void} revive readies a pooled object, with take's arguments
     * @param {number} [capacity] idle objects kept before releases destroy instead
     */
    constructor(
        create,
        park,
        revive,
        capacity=UNBOUNDED,
    ) {
        this._create = create;
        this._park = park;
        this._revive = revive;
        this._capacity = capacity;
        this._idle = [];
    }

    /**
     * A pooled object revived with the given arguments, or a fresh one when the pool is dry.
     * @param {...*} args
     * @returns {*}
     */
    take(...args) {
        const pooled = this._idle.pop();
        if (pooled === undefined) {
            return this._create(...args);
        }
        this._revive(pooled, ...args);
        return pooled;
    }

    /**
     * Parks an object for reuse, or destroys it when the pool is at capacity.
     * @param {*} object
     * @returns {void}
     */
    release(object) {
        if (this._idle.length >= this._capacity) {
            object.destroy();
            return;
        }
        this._park(object);
        this._idle.push(object);
    }
}
