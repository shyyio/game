// localStorage key for the fullscreen preference.
export const DEVICE_SETTING_FULLSCREEN = "shys-power-up-factory.fullscreen";

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
