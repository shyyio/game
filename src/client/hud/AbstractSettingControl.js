/**
 * A settings-menu control; subclasses pick the widget and the bound setting.
 * @abstract
 */
export class AbstractSettingControl {

    /**
     * @param {number|string} key bound setting
     * @param {string} label menu text
     */
    constructor(key, label) {
        this.key = key;
        this.label = label;
    }
}
