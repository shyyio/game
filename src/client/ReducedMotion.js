import {AbstractDevicePreference} from "@/client/AbstractDevicePreference.js";

// Root class the menu stylesheets hang reduced-motion overrides off.
const ROOT_CLASS = "reduced-motion";

/**
 * Singleton holding the reduced-motion preference; while isEnabled, scripted animations
 * (viewport glides, drawer slides) snap to their target instead of tweening, and
 * looping ones (belt scroll) hold still.
 */
class ReducedMotion extends AbstractDevicePreference {

    /**
     * @param {boolean} isEnabled
     * @returns {void}
     */
    setEnabled(isEnabled) {
        document.documentElement.classList.toggle(ROOT_CLASS, isEnabled);
        super.setEnabled(isEnabled);
    }

    isDevicePreferred() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
}

export default new ReducedMotion();
