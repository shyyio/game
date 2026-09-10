import {ListenerList} from "@/common/ListenerList.js";

/**
 * @callback windowFocusCallback
 * @param {boolean} isFocused
 */

/**
 * Singleton tracking whether the window is isFocused and its tab visible, collapsed into one
 * `isFocused` boolean. Listeners attach in init (browser only), like Mouse.
 */
class WindowFocus {

    constructor() {
        this._isFocused = true;
        this._listeners = new ListenerList();
        this._initialized = false;
    }

    /**
     * @returns {boolean}
     */
    get isFocused() {
        return this._isFocused;
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
        window.addEventListener("blur", () => this._apply());
        window.addEventListener("focus", () => this._apply());
        document.addEventListener("visibilitychange", () => this._apply());
        this._apply();
    }

    /**
     * @private
     * @returns {void}
     */
    _apply() {
        const isFocused = document.hasFocus() && !document.hidden;
        if (isFocused === this._isFocused) {
            return;
        }
        this._isFocused = isFocused;
        this._listeners.notify(isFocused);
    }
}

export default new WindowFocus();
