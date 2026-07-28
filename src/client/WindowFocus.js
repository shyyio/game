import {ListenerList} from "@/common/ListenerList.js";

/**
 * @callback windowFocusCallback
 * @param {boolean} focused
 */

/**
 * Singleton tracking whether the window is focused and its tab visible, collapsed into one
 * `focused` boolean. Listeners attach in init (browser only), like Mouse.
 */
class WindowFocus {

    constructor() {
        this._focused = true;
        this._listeners = new ListenerList();
        this._initialized = false;
    }

    /**
     * @returns {boolean}
     */
    get focused() {
        return this._focused;
    }

    /**
     * @param {windowFocusCallback} callback
     * @returns {function(): void} unsubscribe
     */
    onChange(callback) {
        return this._listeners.add(callback);
    }

    /**
     * Attaches the window/document listeners and seeds the current state.
     * @returns {void}
     */
    init() {
        if (this._initialized) {
            return;
        }
        this._initialized = true;
        window.addEventListener("blur", () => this._update());
        window.addEventListener("focus", () => this._update());
        document.addEventListener("visibilitychange", () => this._update());
        this._update();
    }

    /**
     * @private
     * @returns {void}
     */
    _update() {
        const focused = document.hasFocus() && !document.hidden;
        if (focused === this._focused) {
            return;
        }
        this._focused = focused;
        this._listeners.notify(focused);
    }
}

export default new WindowFocus();
