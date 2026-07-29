/**
 * Singleton holding the reduced-motion preference; while on, scripted animations
 * (viewport glides, drawer slides) snap to their target instead of tweening.
 */
class ReducedMotion {

    constructor() {
        this._enabled = false;
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
    }

    /**
     * The OS-level preference, the default when the device setting is unset.
     * @returns {boolean}
     */
    devicePrefers() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
}

export default new ReducedMotion();
