// Root class the menu stylesheets hang reduced-motion overrides off.
const ROOT_CLASS = "reduced-motion";

/**
 * Singleton holding the reduced-motion preference; while on, scripted animations
 * (viewport glides, drawer slides) snap to their target instead of tweening, and
 * looping ones (belt scroll) hold still.
 */
class ReducedMotion {

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
        document.documentElement.classList.toggle(ROOT_CLASS, on);
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
     * The OS-level preference, the default when the device setting is unset.
     * @returns {boolean}
     */
    devicePrefers() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
}

export default new ReducedMotion();
