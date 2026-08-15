import {THEME_DEFAULT, THEME_HIGH_CONTRAST, palette} from "@/client/Theme.js";

// Vuetify theme names, indexed by the pixi palette's theme ids so the menus follow the HUD.
const VUETIFY_THEME_NAMES = ["spupDefault", "spupHighContrast"];

/**
 * @param {number} value - a 0xRRGGBB color
 * @returns {string} its CSS hex
 */
function hex(value) {
    return `#${value.toString(16).padStart(6, "0")}`;
}

const highContrast = palette(THEME_HIGH_CONTRAST);

/**
 * The `themes` block for createVuetify: the default keeps Vuetify's stock light colors, the
 * high-contrast one takes the HUD's palette.
 */
export const vuetifyThemes = {
    [VUETIFY_THEME_NAMES[THEME_DEFAULT]]: {dark: false},
    [VUETIFY_THEME_NAMES[THEME_HIGH_CONTRAST]]: {
        dark: false,
        colors: {
            background: hex(highContrast.PANEL_TINT),
            surface: hex(highContrast.PANEL_TINT),
            "on-background": hex(highContrast.PANEL_TINT_TEXT),
            "on-surface": hex(highContrast.PANEL_TINT_TEXT),
            primary: hex(highContrast.ACTIVE_ACCENT),
            "on-primary": hex(highContrast.PANEL_TEXT),
            secondary: hex(highContrast.PANEL_FILL),
            "on-secondary": hex(highContrast.PANEL_TEXT),
            error: hex(highContrast.WORKER_MISSING_TEXT),
            "on-error": hex(highContrast.PANEL_TEXT),
        },
    },
};

/**
 * @param {number} themeId
 * @returns {string} the Vuetify theme to switch to
 */
export function vuetifyThemeName(themeId) {
    const name = VUETIFY_THEME_NAMES[themeId];
    if (name === undefined) {
        throw new Error(`No Vuetify theme for theme id ${themeId}`);
    }
    return name;
}
