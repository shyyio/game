import {test} from "node:test";
import assert from "node:assert/strict";
import * as Theme from "@/client/Theme.js";
import {vuetifyThemes, vuetifyThemeName} from "@/client/vuetifyTheme.js";

test("applying a theme swaps every color to that palette", () => {
    Theme.applyTheme(Theme.THEME_HIGH_CONTRAST);
    assert.equal(Theme.activeTheme(), Theme.THEME_HIGH_CONTRAST);
    for (const name of Theme.themedColorNames()) {
        assert.equal(Theme[name], Theme.palette(Theme.THEME_HIGH_CONTRAST)[name], name);
    }

    Theme.applyTheme(Theme.THEME_DEFAULT);
    for (const name of Theme.themedColorNames()) {
        assert.equal(Theme[name], Theme.palette(Theme.THEME_DEFAULT)[name], name);
    }
});

test("textOn follows the palette in force", () => {
    Theme.applyTheme(Theme.THEME_DEFAULT);
    // The default accent is light enough to carry dark text; the high-contrast one is not.
    assert.equal(Theme.textOn(Theme.palette(Theme.THEME_DEFAULT).ACTIVE_ACCENT), Theme.PANEL_TINT_TEXT);
    assert.equal(Theme.textOn(Theme.palette(Theme.THEME_HIGH_CONTRAST).ACTIVE_ACCENT), Theme.PANEL_TEXT);
});

test("listeners fire on every apply until they are removed", () => {
    const seen = [];
    const stop = Theme.onThemeChange(themeId => seen.push(themeId));
    Theme.applyTheme(Theme.THEME_HIGH_CONTRAST);
    Theme.applyTheme(Theme.THEME_DEFAULT);
    stop();
    Theme.applyTheme(Theme.THEME_HIGH_CONTRAST);
    Theme.applyTheme(Theme.THEME_DEFAULT);

    assert.deepEqual(seen, [Theme.THEME_HIGH_CONTRAST, Theme.THEME_DEFAULT]);
});

test("an unknown theme id is rejected", () => {
    assert.throws(() => Theme.applyTheme(Theme.THEME_NAMES.length), /Unknown theme id/);
    assert.throws(() => Theme.palette(-1), /Unknown theme id/);
});

test("every theme has a Vuetify theme for the menus", () => {
    for (const [themeId] of Theme.THEME_NAMES.entries()) {
        const name = vuetifyThemeName(themeId);
        assert.ok(vuetifyThemes[name] !== undefined, name);
    }
    assert.equal(Object.keys(vuetifyThemes).length, Theme.THEME_NAMES.length);
    assert.throws(() => vuetifyThemeName(Theme.THEME_NAMES.length), /No Vuetify theme/);
});
