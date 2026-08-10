// localStorage key for the fullscreen preference.
export const DEVICE_SETTING_FULLSCREEN = "spup.fullscreen";
// localStorage key for the reduced-motion preference.
export const DEVICE_SETTING_REDUCED_MOTION = "spup.reduced-motion";
// localStorage key for the mobile-mode preference.
export const DEVICE_SETTING_MOBILE = "spup.mobile";

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
}

export default new DeviceSettings();
