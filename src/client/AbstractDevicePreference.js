import {NotImplementedError} from "@/common/error.js";

/**
 * A device preference the player can override: the current value, and the subscribers told when it
 * changes.
 */
export class AbstractDevicePreference {

    constructor() {
        this._isEnabled = false;
        this._onChange = [];
    }

    /**
     * @returns {boolean}
     */
    get isEnabled() {
        return this._isEnabled;
    }

    /**
     * @param {boolean} isEnabled
     * @returns {void}
     */
    setEnabled(isEnabled) {
        this._isEnabled = isEnabled;
        for (const callback of this._onChange) {
            callback(isEnabled);
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
    isDevicePreferred() {
        throw new NotImplementedError();
    }
}
