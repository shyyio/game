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
     * @param key {string}
     * @param callback {keyboardCallback}
     */
    on(key, callback) {
        if (!(key in this._listeners)) {
            this._listeners[key] = [];
        }

        this._listeners[key].push(callback);
    }

    /**
     * @param event {KeyboardEvent}
     * @private
     */
    _keyDown(event) {
        this._keys[event.key] = true;

        const listeners = this._listeners[event.key];
        if (listeners) {
            listeners.forEach(cb => cb(event));
        }
    }

    /**
     * @param event {KeyboardEvent}
     * @private
     */
    _keyUp(event) {
        this._keys[event.key] = false;
    }
}

export default new Keyboard();