import {reactive, ref, watch} from "vue";
import {AbstractPlayerSettingControl} from "@/client/hud/AbstractPlayerSettingControl.js";
import {PlayerSettingChoice} from "@/client/hud/PlayerSettingChoice.js";
import {PlayerSettingToggle} from "@/client/hud/PlayerSettingToggle.js";
import {PlayerSettingKeybind} from "@/client/hud/PlayerSettingKeybind.js";
import {BINDABLE_KEY_UNBOUND, getBindableKeyByValue, getBindableKeyValueByKeyOrNull} from "@/common/bindableKeys.js";
import {keyLabel} from "@/client/hud/panelButton.js";
import {DeviceSettingToggle} from "@/client/hud/DeviceSettingToggle.js";
import {DeviceSettingChoice} from "@/client/hud/DeviceSettingChoice.js";
import {DeviceSettingSlider} from "@/client/hud/DeviceSettingSlider.js";
import DeviceSettings from "@/client/state/DeviceSettings.js";
import {SETTING_ON, SETTING_OFF} from "@/common/constants.js";

/**
 * Per-type value mirroring: a toggle models a boolean, a choice models the option index.
 * @param {AbstractSettingControl} control
 * @param {number|undefined} value
 * @returns {number|boolean}
 */
function controlModel(control, value) {
    if (control instanceof PlayerSettingChoice) {
        if (value === undefined) {
            return control.defaultIndex;
        }
        return value;
    }
    if (control instanceof PlayerSettingToggle) {
        return value !== SETTING_OFF;
    }
    if (control instanceof PlayerSettingKeybind) {
        return value;
    }
    throw new Error(`Settings control "${control.label}" has an unknown control type`);
}

export class SettingsMenuBindings {

    /**
     * @param {object} settingsCategories a ref of the categories and their controls
     * @param {object} settingValues each control's reactive value
     * @param {function(Client): void} bindSettingsMenu
     * @param {object} capturingControl a ref of the keybind control awaiting its next press
     * @param {function(PlayerSettingKeybind): string} keybindText
     * @param {function(PlayerSettingKeybind): void} toggleCapture
     * @param {function(KeyboardEvent): void} onCaptureKey
     */
    constructor({
        settingsCategories,
        settingValues,
        bindSettingsMenu,
        capturingControl,
        keybindText,
        toggleCapture,
        onCaptureKey,
    }) {
        this.settingsCategories = settingsCategories;
        this.settingValues = settingValues;
        this.bindSettingsMenu = bindSettingsMenu;
        this.capturingControl = capturingControl;
        this.keybindText = keybindText;
        this.toggleCapture = toggleCapture;
        this.onCaptureKey = onCaptureKey;
    }
}

/**
 * Reactive settings-menu state: categories/controls, and each control's value mirrored
 * to/from the device-settings store or the client's player-settings cache.
 * @returns {SettingsMenuBindings}
 */
export function useSettingsMenu() {
    const settingsCategories = ref([]);
    const settingValues = reactive({});
    // The keybind control listening for its next press; null while none is armed.
    const capturingControl = ref(null);
    let boundClient = null;

    /**
     * Seeds a control's reactive value and wires it to fire onChange when the user edits it.
     * @param {AbstractSettingControl} control
     * @param {number|boolean} initial
     * @param {function(number|boolean): void} onChange
     * @returns {void}
     */
    function mirror(control, initial, onChange) {
        settingValues[control.key] = initial;
        watch(() => settingValues[control.key], onChange);
    }

    /**
     * Populates the categories and wires their controls against the client; call once the
     * client is ready.
     * @param {Client} client
     * @returns {void}
     */
    function bindSettingsMenu(client) {
        boundClient = client;
        const categories = client.settingsMenu.categories();
        const controls = categories.flatMap(category => category.controls);
        const deviceToggles = controls.filter(control => control instanceof DeviceSettingToggle);
        const deviceChoices = controls.filter(control => control instanceof DeviceSettingChoice);
        const deviceSliders = controls.filter(control => control instanceof DeviceSettingSlider);
        const playerControls = controls.filter(control => control instanceof AbstractPlayerSettingControl);
        const controlByKey = new Map(playerControls.map(control => [control.key, control]));
        client.cache.subscribe("playerSettings.values", (key, value) => {
            const control = controlByKey.get(key);
            if (control !== undefined) {
                settingValues[key] = controlModel(control, value);
            }
        });
        const playerSettings = client.cache.view("playerSettings");
        for (const control of deviceToggles) {
            const initial = DeviceSettings.getBoolean(control.key, control.fallback);
            control.apply(initial);
            mirror(control, initial, on => {
                DeviceSettings.setBoolean(control.key, on);
                // The switch tap is the user gesture a fullscreen request needs.
                control.apply(on);
            });
        }
        for (const control of deviceChoices) {
            const stored = DeviceSettings.getNumber(control.key, control.fallback);
            let initial = stored;
            if (initial < 0 || initial >= control.options.length) {
                initial = control.fallback;
            }
            control.apply(initial);
            mirror(control, initial, index => {
                DeviceSettings.setNumber(control.key, index);
                control.apply(index);
            });
        }
        for (const control of deviceSliders) {
            const stored = DeviceSettings.getFloat(control.key, control.fallback);
            let initial = stored;
            if (initial < control.min || initial > control.max) {
                initial = control.fallback;
            }
            control.apply(initial);
            mirror(control, initial, value => {
                DeviceSettings.setNumber(control.key, value);
                control.apply(value);
            });
        }
        for (const control of playerControls) {
            // A keybind writes through the cache, which also unbinds whoever held the key.
            if (control instanceof PlayerSettingKeybind) {
                settingValues[control.key] = client.keybindings.getValueByEntry(control.keybinding);
                continue;
            }
            // Seed from the cache: the settings sync may have landed during client init.
            const initial = controlModel(control, playerSettings.getValueByKey(control.key));
            mirror(control, initial, modelValue => {
                if (control instanceof PlayerSettingChoice) {
                    client.setPlayerSetting(control.key, modelValue);
                    return;
                }
                client.setPlayerSetting(control.key, modelValue ? SETTING_ON : SETTING_OFF);
            });
        }
        settingsCategories.value = categories;
    }

    /**
     * The key text a keybind row shows: the prompt while armed, the bound key, or "Unbound".
     * @param {PlayerSettingKeybind} control
     * @returns {string}
     */
    function keybindText(control) {
        if (capturingControl.value === control) {
            return "Press a key";
        }
        const value = settingValues[control.key];
        if (value === BINDABLE_KEY_UNBOUND) {
            return "Unbound";
        }
        return keyLabel(getBindableKeyByValue(value));
    }

    /**
     * Arms a keybind control for its next press; pressing the armed one again disarms it.
     * @param {PlayerSettingKeybind} control
     * @returns {void}
     */
    function toggleCapture(control) {
        if (capturingControl.value === control) {
            capturingControl.value = null;
        } else {
            capturingControl.value = control;
        }
    }

    /**
     * Binds the pressed key to the armed control, unbinding whichever action holds it today.
     * Escape cancels, and a key no binding may hold leaves the control armed.
     * @param {KeyboardEvent} event
     * @returns {void}
     */
    function onCaptureKey(event) {
        const control = capturingControl.value;
        if (control === null) {
            return;
        }
        // The game's own shortcuts listen on window; a captured press is not one of them.
        event.stopPropagation();
        event.preventDefault();
        if (event.key === "Escape") {
            capturingControl.value = null;
            return;
        }
        if (getBindableKeyValueByKeyOrNull(event.key) === null) {
            return;
        }
        boundClient.keybindings.setKeyByEntry(control.keybinding, event.key);
        capturingControl.value = null;
    }

    return new SettingsMenuBindings({
        settingsCategories,
        settingValues,
        bindSettingsMenu,
        capturingControl,
        keybindText,
        toggleCapture,
        onCaptureKey,
    });
}
