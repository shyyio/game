
/**
 * @abstract
 */
export class AbstractValueStore {

    constructor() {
        this._values = new Map();
        this._listeners = [];
    }

    /**
     * @param {number} key
     * @returns {number|null} null if no value has been received from the server yet
     */
    get(key) {
        const value = this._values.get(key);
        if (value === undefined) {
            return null;
        }
        return value;
    }

    /**
     * @param {function(key: number, value: number)} callback
     */
    onChange(callback) {
        this._listeners.push(callback);
    }

    update(key, value) {
        const prev = this._values.get(key);
        this._values.set(key, value);
        if (prev !== value) {
            this._listeners.forEach(cb => cb(key, value));
        }
    }
}
