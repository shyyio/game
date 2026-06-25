// Haptic (rumble) feedback for touch devices, via the Web Vibration API.
//
// Support is uneven: Android Chrome/Firefox vibrate, while iOS Safari exposes no
// `navigator.vibrate` at all. The API also only fires inside a user gesture (a
// tap), which is exactly when this is used. Everywhere it isn't available it
// degrades to a silent no-op, so callers never need to feature-check.

// A short pulse for a discrete action: a button tap or a placement.
const TAP_DURATION_MS = 10;

class Haptics {

    constructor() {
        this._supported = typeof navigator !== "undefined"
            && typeof navigator.vibrate === "function";
    }

    /**
     * Whether the device exposes the Vibration API.
     * @returns {boolean}
     */
    get supported() {
        return this._supported;
    }

    /**
     * A short pulse acknowledging a discrete action (button tap, placement).
     * @returns {void}
     */
    tap() {
        this.vibrate(TAP_DURATION_MS);
    }

    /**
     * Plays a vibration (a duration in ms or on/off pattern); ignored where unavailable.
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
