import {AbstractSettingControl} from "@/client/AbstractSettingControl.js";

/**
 * An on/off switch bound to a localStorage device setting; never synced.
 */
export class DeviceSettingToggle extends AbstractSettingControl {

    /**
     * @param {string} key localStorage key
     * @param {string} label menu text
     * @param {boolean} fallback value while unset
     * @param {function(boolean): void} apply pushes the value into the owning singleton
     */
    constructor(key, label, fallback, apply) {
        super(key, label);
        this.fallback = fallback;
        this.apply = apply;
    }
}
