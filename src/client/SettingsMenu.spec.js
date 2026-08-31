import {test} from "node:test";
import assert from "node:assert/strict";

import {SettingsMenu} from "@/client/SettingsMenu.js";
import {SettingCategory} from "@/client/hud/SettingCategory.js";
import {PlayerSettingChoice} from "@/client/hud/PlayerSettingChoice.js";
import {PlayerSettingToggle} from "@/client/hud/PlayerSettingToggle.js";
import {AbstractPlayerSettingControl} from "@/client/hud/AbstractPlayerSettingControl.js";
import {DEVICE_SETTING_TERRAIN} from "@/client/state/DeviceSettings.js";
import {FPS_CAP_VALUES} from "@/client/constants.js";

// The menu reads device preferences and the reduced-motion media query, both browser-only.
class FakeStorage {

    constructor() {
        this._values = new Map();
    }

    getItem(key) {
        if (!this._values.has(key)) {
            return null;
        }
        return this._values.get(key);
    }

    setItem(key, value) {
        this._values.set(key, value);
    }
}

const storage = new FakeStorage();
globalThis.localStorage = storage;
globalThis.window = {matchMedia: () => ({matches: false})};

const DISPLAY = "Display";
const MOD_CATEGORY = "Belts";
// Sorts after the engine's own section, which claims order 0.
const MOD_CATEGORY_ORDER = 5;
const SETTING_KEY = 3;
const UNREGISTERED_KEY = 99;
const BINARY = 2;

class FakeTerrainLayer {

    constructor() {
        this.repaints = 0;
        this.enabled = null;
    }

    repaint() {
        this.repaints += 1;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
    }
}

class FakeClient {

    constructor() {
        this.terrainLayer = new FakeTerrainLayer();
        this.terrainDetailLayer = new FakeTerrainLayer();
        this.terrain = null;
        this.debugLayers = null;
        this.eventLogging = null;
        this.app = {ticker: {maxFPS: 0}};
        this.drawLayerRegistry = {setDebugMode: on => {
            this.debugLayers = on;
        }};
        this.events = {setLogging: on => {
            this.eventLogging = on;
        }};
        this.modRegistry = {
            clientMods: [],
            settingEntries: new Map(),
            playerSettingEntry(key) {
                return this.settingEntries.get(key);
            },
        };
    }

    /**
     * Registers one client mod contributing the given settings controls.
     * @returns {void}
     */
    addSettingsMod(controls) {
        this.modRegistry.clientMods.push({
            settingsCategories: () => [new SettingCategory(MOD_CATEGORY, MOD_CATEGORY_ORDER, controls)],
        });
    }
}

/**
 * @returns {{menu: SettingsMenu, client: FakeClient}}
 */
function build() {
    const client = new FakeClient();
    return {menu: new SettingsMenu(client), client};
}

test("the engine contributes a Display section", () => {
    const {menu} = build();
    const categories = menu.categories();
    assert.deepEqual(categories.map(category => category.name), [DISPLAY]);
    assert.ok(categories[0].controls.some(control => control.label === "Terrain"));
});

test("a mod's section merges in behind the engine's", () => {
    const {menu, client} = build();
    client.modRegistry.settingEntries.set(SETTING_KEY, {clientWritable: true, optionCount: BINARY});
    client.addSettingsMod([new PlayerSettingToggle(SETTING_KEY, "Ghost preview")]);
    assert.deepEqual(menu.categories().map(category => category.name), [DISPLAY, MOD_CATEGORY]);
});

test("a control on an unregistered player setting is rejected", () => {
    const {menu, client} = build();
    client.addSettingsMod([new PlayerSettingToggle(UNREGISTERED_KEY, "Ghost preview")]);
    assert.throws(() => menu.categories(), /unregistered player setting key/);
});

test("a control on a server-authoritative setting is rejected", () => {
    const {menu, client} = build();
    client.modRegistry.settingEntries.set(SETTING_KEY, {clientWritable: false, optionCount: BINARY});
    client.addSettingsMod([new PlayerSettingToggle(SETTING_KEY, "Ghost preview")]);
    assert.throws(() => menu.categories(), /server-authoritative/);
});

test("a choice offering a different number of options than the setting allows is rejected", () => {
    const {menu, client} = build();
    client.modRegistry.settingEntries.set(SETTING_KEY, {clientWritable: true, optionCount: 3});
    client.addSettingsMod([new PlayerSettingChoice(SETTING_KEY, "Ghost style", ["a", "b"], 0)]);
    assert.throws(() => menu.categories(), /offers 2 options but/);
});

test("a toggle on a setting with more than two values is rejected", () => {
    const {menu, client} = build();
    client.modRegistry.settingEntries.set(SETTING_KEY, {clientWritable: true, optionCount: 3});
    client.addSettingsMod([new PlayerSettingToggle(SETTING_KEY, "Ghost preview")]);
    assert.throws(() => menu.categories(), /which allows 3 values/);
});

test("a player control that is neither a choice nor a toggle is rejected", () => {
    class MysteryControl extends AbstractPlayerSettingControl {

    }

    const {menu, client} = build();
    client.modRegistry.settingEntries.set(SETTING_KEY, {clientWritable: true, optionCount: BINARY});
    client.addSettingsMod([new MysteryControl(SETTING_KEY, "Ghost preview")]);
    assert.throws(() => menu.categories(), /unknown control type/);
});

test("debug mode drives the debug draw layers and the event log together", () => {
    const {menu, client} = build();
    menu.toggleDebugMode();
    assert.equal(client.debugLayers, true);
    assert.equal(client.eventLogging, true);

    menu.toggleDebugMode();
    assert.equal(client.debugLayers, false);
    assert.equal(client.eventLogging, false);
});

test("the frame-rate cap paces the render ticker", () => {
    const {menu, client} = build();
    menu.setFpsCap(1);
    assert.equal(client.app.ticker.maxFPS, FPS_CAP_VALUES[1]);
});

test("a repaint rebakes both ground layers, keeping the classification", () => {
    const {menu, client} = build();
    client.terrain = {invalidations: 0, invalidate() {
        this.invalidations += 1;
    }};
    menu.repaintTerrain();
    assert.equal(client.terrainLayer.repaints, 1);
    assert.equal(client.terrainDetailLayer.repaints, 1);
    assert.equal(client.terrain.invalidations, 0);
});

test("a retune reclassifies before repainting", () => {
    const {menu, client} = build();
    client.terrain = {invalidations: 0, invalidate() {
        this.invalidations += 1;
    }};
    menu.retuneTerrain();
    assert.equal(client.terrain.invalidations, 1);
    assert.equal(client.terrainLayer.repaints, 1);
});

test("a retune before the seed arrives still repaints", () => {
    const {menu, client} = build();
    menu.retuneTerrain();
    assert.equal(client.terrainLayer.repaints, 1);
});

test("the stored terrain preference drives the ground from the start", () => {
    storage.setItem(DEVICE_SETTING_TERRAIN, "1");
    const {client} = build();
    assert.equal(client.terrainLayer.enabled, true);
    assert.equal(client.terrainDetailLayer.enabled, true);

    storage.setItem(DEVICE_SETTING_TERRAIN, "0");
    const off = build();
    assert.equal(off.client.terrainLayer.enabled, false);
});
