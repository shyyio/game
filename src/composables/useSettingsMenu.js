import {reactive, ref, watch} from "vue";
import {AbstractPlayerSettingControl} from "@/client/hud/AbstractPlayerSettingControl.js";
import {PlayerSettingChoice} from "@/client/hud/PlayerSettingChoice.js";
import {PlayerSettingToggle} from "@/client/hud/PlayerSettingToggle.js";
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
    throw new Error(`Settings control "${control.label}" has an unknown control type`);
}

/**
 * Reactive settings-menu state: categories/controls, and each control's value mirrored
 * to/from the device-settings store or the client's player-settings cache.
 * @returns {{settingsCategories: object, settingValues: object, bindSettingsMenu: function(Client): void}}
 */
export function useSettingsMenu() {
    const settingsCategories = ref([]);
    const settingValues = reactive({});

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
            // Seed from the cache: the settings sync may have landed during client init.
            const initial = controlModel(control, playerSettings.get(control.key));
            mirror(control, initial, modelValue => {
                if (control instanceof PlayerSettingChoice) {
                    client.updatePlayerSetting(control.key, modelValue);
                    return;
                }
                client.updatePlayerSetting(control.key, modelValue ? SETTING_ON : SETTING_OFF);
            });
        }
        settingsCategories.value = categories;
    }

    return {settingsCategories, settingValues, bindSettingsMenu};
}
