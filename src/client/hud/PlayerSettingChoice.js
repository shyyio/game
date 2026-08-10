import {AbstractPlayerSettingControl} from "@/client/hud/AbstractPlayerSettingControl.js";

/**
 * A drop-down list; the setting holds the chosen option's index.
 */
export class PlayerSettingChoice extends AbstractPlayerSettingControl {

    /**
     * @param {number} key player-setting key
     * @param {string} label menu text
     * @param {string[]} options option labels, indexed by stored value
     * @param {number} defaultIndex option shown while the setting is absent
     */
    constructor(key, label, options, defaultIndex) {
        super(key, label);
        this.options = options;
        this.defaultIndex = defaultIndex;
        // Prebuilt v-select items; the template binds them by reference every render.
        this.items = options.map((title, value) => ({title, value}));
    }
}
