// Haptic feedback via Web Vibration API; silent no-op where unavailable.

const TAP_DURATION_MS = 10;

class Haptics {

    constructor() {
        this._supported = typeof navigator !== "undefined"
            && typeof navigator.vibrate === "function";
    }

    /**
     * Whether the Vibration API is available.
     * @returns {boolean}
     */
    get supported() {
        return this._supported;
    }

    /**
     * Short pulse for a discrete action.
     * @returns {void}
     */
    tap() {
        this.vibrate(TAP_DURATION_MS);
    }

    /**
     * Play a vibration; ignored where unavailable.
     * @param {number|number[]} pattern - duration in ms, or alternating on/off ms
     * @returns {void}
     */
    vibrate(pattern) {
        if (!this._supported) {
            return;
        }
        navigator.vibrate(pattern);
    }
}

export default new Haptics();
