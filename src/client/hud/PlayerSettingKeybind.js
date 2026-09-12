import {AbstractPlayerSettingControl} from "@/client/hud/AbstractPlayerSettingControl.js";

/**
 * A press-to-bind button; the setting holds the key's index into BINDABLE_KEYS.
 */
export class PlayerSettingKeybind extends AbstractPlayerSettingControl {

    /**
     * @param {KeybindingEntry} keybinding
     */
    constructor(keybinding) {
        super(keybinding.playerSettingKey, keybinding.label);
        this.keybinding = keybinding;
    }
}
