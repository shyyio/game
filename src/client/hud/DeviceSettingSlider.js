import {AbstractSettingControl} from "@/client/hud/AbstractSettingControl.js";

/**
 * A numeric slider bound to a localStorage device setting; never synced.
 */
export class DeviceSettingSlider extends AbstractSettingControl {

    /**
     * @param {string} key localStorage key
     * @param {string} label menu text
     * @param {number} min
     * @param {number} max
     * @param {number} step
     * @param {number} fallback value while unset
     * @param {function(number): void} apply pushes the value into the owning singleton
     */
    constructor(key, label, min, max, step, fallback, apply) {
        super(key, label);
        this.min = min;
        this.max = max;
        this.step = step;
        this.fallback = fallback;
        this.apply = apply;
    }
}
