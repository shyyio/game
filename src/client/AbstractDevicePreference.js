import {NotImplementedError} from "@/common/error.js";

/**
 * A device preference the player can override: the current value, and the subscribers told when it
 * changes.
 */
export class AbstractDevicePreference {

    constructor() {
        this._enabled = false;
        this._onChange = [];
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
        for (const callback of this._onChange) {
            callback(on);
        }
    }

    /**
     * @param {function(boolean): void} callback
     * @returns {function(): void} unsubscribe
     */
    onChange(callback) {
        this._onChange.push(callback);
        return () => {
            const index = this._onChange.indexOf(callback);
            if (index !== -1) {
                this._onChange.splice(index, 1);
            }
        };
    }

    /**
     * The device's own answer, the default when the player has set nothing.
     * @abstract
     * @returns {boolean}
     */
    devicePrefers() {
        throw new NotImplementedError();
    }
}
