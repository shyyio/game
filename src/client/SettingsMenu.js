import {SettingCategory} from "@/client/hud/SettingCategory.js";
import {AbstractPlayerSettingControl} from "@/client/hud/AbstractPlayerSettingControl.js";
import {PlayerSettingChoice} from "@/client/hud/PlayerSettingChoice.js";
import {PlayerSettingToggle} from "@/client/hud/PlayerSettingToggle.js";
import {DeviceSettingToggle} from "@/client/hud/DeviceSettingToggle.js";
import {DeviceSettingChoice} from "@/client/hud/DeviceSettingChoice.js";
import {DeviceSettingSlider} from "@/client/hud/DeviceSettingSlider.js";
import DeviceSettings, {
    DEVICE_SETTING_FULLSCREEN, DEVICE_SETTING_REDUCED_MOTION, DEVICE_SETTING_MOBILE,
    DEVICE_SETTING_THEME, DEVICE_SETTING_TERRAIN, DEVICE_SETTING_FPS_CAP,
    DEVICE_SETTING_UI_SCALE,
} from "@/client/state/DeviceSettings.js";
import {applyUiScale, UI_SCALE_NORMAL, UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_STEP} from "@/client/hud/UiScale.js";
import {applyTheme, THEME_NAMES, THEME_DEFAULT} from "@/client/Theme.js";
import Fullscreen from "@/client/Fullscreen.js";
import ReducedMotion from "@/client/ReducedMotion.js";
import Mobile from "@/client/Mobile.js";
import {FPS_CAP_NAMES, FPS_CAP_VALUES, FPS_CAP_DEFAULT} from "@/client/constants.js";

// Terrain rendering while the device setting is unset.
const TERRAIN_ENABLED_DEFAULT = false;

/**
 * The settings menu's catalog, merged from the engine's own section and every client mod's, and
 * the client-side actions its entries fire.
 */
export class SettingsMenu {

    /**
     * @param {Client} client
     */
    constructor(client) {
        this._client = client;
        this._debugMode = false;
        // The stored device setting drives the ground the same way the menu's toggle does.
        this.setTerrainEnabled(DeviceSettings.getBoolean(DEVICE_SETTING_TERRAIN, TERRAIN_ENABLED_DEFAULT));
    }

    /**
     * Gathers and merges every mod's settings categories, validating player control keys.
     * @returns {SettingCategory[]}
     */
    categories() {
        const contributions = this._coreCategories()
            .concat(this._client.modRegistry.clientMods.flatMap(mod => mod.settingsCategories(this._client)));
        const categories = SettingCategory.merge(contributions);
        const controls = categories.flatMap(category => category.controls);
        for (const control of controls) {
            if (!(control instanceof AbstractPlayerSettingControl)) {
                continue;
            }
            const entry = this._client.modRegistry.playerSettingEntry(control.key);
            if (entry === undefined) {
                throw new Error(`Settings control "${control.label}" targets unregistered player setting key ${control.key}`);
            }
            if (!entry.clientWritable) {
                throw new Error(`Settings control "${control.label}" targets server-authoritative player setting key ${control.key}`);
            }
            if (control instanceof PlayerSettingChoice) {
                if (control.options.length !== entry.optionCount) {
                    throw new Error(`Settings control "${control.label}" offers ${control.options.length} options but player setting key ${control.key} allows ${entry.optionCount}`);
                }
            } else if (control instanceof PlayerSettingToggle) {
                if (entry.optionCount !== 2) {
                    throw new Error(`Settings control "${control.label}" toggles player setting key ${control.key}, which allows ${entry.optionCount} values`);
                }
            } else {
                throw new Error(`Settings control "${control.label}" has an unknown control type`);
            }
        }
        return categories;
    }

    /**
     * Toggles debug mode, showing or hiding debug-only draw layers and logging arriving events.
     * @returns {void}
     */
    toggleDebugMode() {
        this._debugMode = !this._debugMode;
        this._client.drawLayerRegistry.setDebugMode(this._debugMode);
        this._client.events.setLogging(this._debugMode);
    }

    /**
     * Paces the render ticker to the chosen frame-rate option.
     * @param {number} index into FPS_CAP_VALUES
     * @returns {void}
     */
    setFpsCap(index) {
        this._client.app.ticker.maxFPS = FPS_CAP_VALUES[index];
    }

    /**
     * Rebakes the ground's palette and rescatters its details, keeping the biome classification: a
     * retuned color, shade or dither.
     * @returns {void}
     */
    repaintTerrain() {
        this._client.terrainLayer.repaint();
        this._client.terrainDetailLayer.repaint();
    }

    /**
     * Reclassifies as well as repaints: a retuned noise channel, biome range or blend width changes
     * which biome a tile is, which the cached bakes would otherwise keep answering.
     * @returns {void}
     */
    retuneTerrain() {
        if (this._client.terrain !== null) {
            this._client.terrain.invalidate();
        }
        this.repaintTerrain();
    }

    /**
     * Shows or hides the ground and its scattered details.
     * @param {boolean} enabled
     * @returns {void}
     */
    setTerrainEnabled(enabled) {
        this._client.terrainLayer.setEnabled(enabled);
        this._client.terrainDetailLayer.setEnabled(enabled);
    }

    /**
     * The engine's own settings section: device toggles and the theme picker.
     * @private
     * @returns {SettingCategory[]}
     */
    _coreCategories() {
        return [
            new SettingCategory("Display", 0, [
                new DeviceSettingToggle(DEVICE_SETTING_FULLSCREEN, "Fullscreen", false, on => Fullscreen.setEnabled(on)),
                new DeviceSettingToggle(DEVICE_SETTING_REDUCED_MOTION, "Reduced motion", ReducedMotion.devicePrefers(), on => ReducedMotion.setEnabled(on)),
                new DeviceSettingToggle(DEVICE_SETTING_MOBILE, "Touchscreen input", Mobile.devicePrefers(), on => Mobile.setEnabled(on)),
                new DeviceSettingToggle(DEVICE_SETTING_TERRAIN, "Terrain", TERRAIN_ENABLED_DEFAULT, on => this.setTerrainEnabled(on)),
                new DeviceSettingChoice(DEVICE_SETTING_THEME, "Theme", THEME_NAMES, THEME_DEFAULT, index => applyTheme(index)),
                new DeviceSettingChoice(DEVICE_SETTING_FPS_CAP, "Frame rate cap", FPS_CAP_NAMES, FPS_CAP_DEFAULT, index => this.setFpsCap(index)),
                new DeviceSettingSlider(DEVICE_SETTING_UI_SCALE, "UI Scale", UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_STEP, UI_SCALE_NORMAL, scale => applyUiScale(scale)),
            ]),
        ];
    }

}
