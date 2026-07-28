/**
 * A settings-menu control bound to a client-writable player setting; subclasses pick the widget
 * and value shape. Labels live here, client-only — the wire and the sim see only the numeric key.
 * @abstract
 */
export class AbstractPlayerSettingControl {

    /**
     * @param {number} key player-setting key
     * @param {string} label menu text
     */
    constructor(key, label) {
        this.key = key;
        this.label = label;
    }
}
