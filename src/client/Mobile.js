import {isMobile} from "pixi.js";

/**
 * Singleton holding the mobile-mode preference, overriding pixi's device detection.
 */
class Mobile {

    constructor() {
        this._enabled = false;
        this._onChange = null;
    }

    /**
     * @returns {boolean}
     */
    get enabled() {
        return this._enabled;
    }

    /**
     * @param {boolean} on
     * @returns {void}
     */
    setEnabled(on) {
        this._enabled = on;
        if (this._onChange !== null) {
            this._onChange(on);
        }
    }

    /**
     * @param {function(boolean): void} callback
     * @returns {function(): void} unsubscribe
     */
    onChange(callback) {
        this._onChange = callback;
        return () => {
            if (this._onChange === callback) {
                this._onChange = null;
            }
        };
    }

    /**
     * Fallback when the device setting is unset.
     * @returns {boolean}
     */
    devicePrefers() {
        return isMobile.any;
    }
}

export default new Mobile();
