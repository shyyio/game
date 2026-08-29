// localStorage key for the fullscreen preference.
export const DEVICE_SETTING_FULLSCREEN = "spup.fullscreen";
// localStorage key for the reduced-motion preference.
export const DEVICE_SETTING_REDUCED_MOTION = "spup.reduced-motion";
// localStorage key for the mobile-mode preference.
export const DEVICE_SETTING_MOBILE = "spup.mobile";
// localStorage key for the color-theme preference.
export const DEVICE_SETTING_THEME = "spup.theme";
// localStorage key for the terrain-rendering preference.
export const DEVICE_SETTING_TERRAIN = "spup.terrain";
// localStorage key for the frame-rate cap preference.
export const DEVICE_SETTING_FPS_CAP = "spup.fps-cap";
// localStorage key for the UI scale preference.
export const DEVICE_SETTING_UI_SCALE = "spup.ui-scale";

/**
 * Singleton for per-device preferences persisted in localStorage, never in saves.
 */
class DeviceSettings {

    /**
     * @param {string} key
     * @param {boolean} fallback
     * @returns {boolean}
     */
    getBoolean(key, fallback) {
        const stored = localStorage.getItem(key);
        if (stored === null) {
            return fallback;
        }
        return stored === "1";
    }

    /**
     * @param {string} key
     * @param {boolean} value
     * @returns {void}
     */
    setBoolean(key, value) {
        localStorage.setItem(key, value ? "1" : "0");
    }

    /**
     * @param {string} key
     * @param {number} fallback - also used when the stored value is not an integer
     * @returns {number}
     */
    getNumber(key, fallback) {
        const stored = localStorage.getItem(key);
        if (stored === null) {
            return fallback;
        }
        const value = Number(stored);
        if (!Number.isInteger(value)) {
            return fallback;
        }
        return value;
    }

    /**
     * @param {string} key
     * @param {number} fallback - also used when the stored value is not a finite number
     * @returns {number}
     */
    getFloat(key, fallback) {
        const stored = localStorage.getItem(key);
        if (stored === null) {
            return fallback;
        }
        const value = Number(stored);
        if (!Number.isFinite(value)) {
            return fallback;
        }
        return value;
    }

    /**
     * @param {string} key
     * @param {number} value
     * @returns {void}
     */
    setNumber(key, value) {
        localStorage.setItem(key, String(value));
    }
}

export default new DeviceSettings();
