import {AbstractSettingControl} from "@/client/hud/AbstractSettingControl.js";

/**
 * A drop-down bound to a localStorage device setting, holding the chosen option's index; never synced.
 */
export class DeviceSettingChoice extends AbstractSettingControl {

    /**
     * @param {string} key localStorage key
     * @param {string} label menu text
     * @param {string[]} options option labels, indexed by stored value
     * @param {number} fallback option shown while the setting is unset
     * @param {function(number): void} apply pushes the value into the owning singleton
     */
    constructor(key, label, options, fallback, apply) {
        super(key, label);
        this.options = options;
        this.fallback = fallback;
        this.apply = apply;
        // Prebuilt v-select items; the template binds them by reference every render.
        this.items = options.map((title, value) => ({title, value}));
    }
}
