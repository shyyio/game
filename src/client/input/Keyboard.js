/**
 * @callback keyboardCallback
 * @param  {KeyboardEvent} event
 */

class Keyboard {

    constructor() {
        window.addEventListener("keydown", event => this._keyDown(event));
        window.addEventListener("keyup", event => this._keyUp(event));

        this._keys = {};
        this._listeners = {};
    }

    /**
     * @param {string} key
     * @param {keyboardCallback} callback
     */
    on(key, callback) {
        if (!(key in this._listeners)) {
            this._listeners[key] = [];
        }

        this._listeners[key].push(callback);
    }

    /**
     * @param {string} key
     * @param {keyboardCallback} callback
     */
    off(key, callback) {
        const listeners = this._listeners[key];
        if (!listeners) {
            return;
        }
        const index = listeners.indexOf(callback);
        if (index !== -1) {
            listeners.splice(index, 1);
        }
    }

    /**
     * @param {KeyboardEvent} event
     * @private
     */
    _keyDown(event) {
        this._keys[event.key] = true;

        const listeners = this._listeners[event.key];
        if (listeners) {
            for (const cb of listeners) {
                cb(event);
            }
        }
    }

    /**
     * @param {KeyboardEvent} event
     * @private
     */
    _keyUp(event) {
        this._keys[event.key] = false;
    }
}

export default new Keyboard();