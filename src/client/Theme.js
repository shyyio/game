import {Color} from "pixi.js";
import {getOrCreate} from "@/common/util.js";
import {contrastRatio} from "@/client/contrast.js";

// Central color palette for all client-side (pixi) rendering. Mods keep their own
// domain palettes; this holds shared HUD/panel colors and engine render colors.

// ---- Themes ----
// A theme names one full set of the colors below. Ids are the dropdown's option indices: only append.
export const THEME_DEFAULT = 0;
export const THEME_HIGH_CONTRAST = 1;
export const THEME_NAMES = ["Default", "High contrast"];

// Light warm panels, dark translucent fill under the round buttons.
const DEFAULT_PALETTE = {
    PANEL_FILL: 0x1a1a1a,
    PANEL_FILL_ALPHA: 0.92,
    PANEL_BORDER: 0x555555,
    PANEL_TEXT: 0xffffff,
    PANEL_HOVER_FILL: 0x5a5a5a,
    ACTIVE_ACCENT: 0x5bb5ff,
    LABEL_EMPHASIS: 0xffd24a,
    PANEL_TINT: 0xeee6d8,
    SCROLLBAR_TRACK_TINT: 0xe4ddcf,
    PANEL_TINT_TEXT: 0x000000,
    PANEL_TITLE_TEXT: 0x000000,
    SLOT_HIGHLIGHT_COLOR: 0x9be89b,
    CONNECTOR_COLOR: 0x000000,
    PROGRESS_BAR_TINT: 0x81ff08,
    PROGRESS_TEXT_COLOR: 0xffffff,
    PROGRESS_TEXT_STROKE: 0x111111,
    WORKER_OK_TEXT: 0x81ff08,
    WORKER_MISSING_TEXT: 0xf23030,
};

// Every pairing clears WCAG AAA (see text-contrast.spec.js): white panels, black text, accents
// dark enough for white labels.
const HIGH_CONTRAST_PALETTE = {
    PANEL_FILL: 0x000000,
    PANEL_FILL_ALPHA: 1,
    PANEL_BORDER: 0x1a1a1a,
    PANEL_TEXT: 0xffffff,
    PANEL_HOVER_FILL: 0x3a3a3a,
    ACTIVE_ACCENT: 0x0a3d91,
    LABEL_EMPHASIS: 0xffe066,
    PANEL_TINT: 0xffffff,
    SCROLLBAR_TRACK_TINT: 0xd0d0d0,
    PANEL_TINT_TEXT: 0x000000,
    PANEL_TITLE_TEXT: 0x000000,
    SLOT_HIGHLIGHT_COLOR: 0x9be89b,
    CONNECTOR_COLOR: 0x000000,
    PROGRESS_BAR_TINT: 0x006b1f,
    PROGRESS_TEXT_COLOR: 0xffffff,
    PROGRESS_TEXT_STROKE: 0x000000,
    WORKER_OK_TEXT: 0x00591a,
    WORKER_MISSING_TEXT: 0xa10000,
};

const PALETTES = [DEFAULT_PALETTE, HIGH_CONTRAST_PALETTE];

// ---- HUD panel background (mini-menu, rotate buttons, status message) ----
export let PANEL_FILL = DEFAULT_PALETTE.PANEL_FILL;
export let PANEL_FILL_ALPHA = DEFAULT_PALETTE.PANEL_FILL_ALPHA;
export let PANEL_BORDER = DEFAULT_PALETTE.PANEL_BORDER;
export let PANEL_TEXT = DEFAULT_PALETTE.PANEL_TEXT; // text and icons over the dark translucent fill
export let PANEL_HOVER_FILL = DEFAULT_PALETTE.PANEL_HOVER_FILL;

// ---- Accents ----
export let ACTIVE_ACCENT = DEFAULT_PALETTE.ACTIVE_ACCENT; // pressed/active control highlight
export let LABEL_EMPHASIS = DEFAULT_PALETTE.LABEL_EMPHASIS;

// ---- Inspect & toolbar panels (ui frame background) ----
export let PANEL_TINT = DEFAULT_PALETTE.PANEL_TINT; // tint over the ui frame
export let SCROLLBAR_TRACK_TINT = DEFAULT_PALETTE.SCROLLBAR_TRACK_TINT;
export let PANEL_TINT_TEXT = DEFAULT_PALETTE.PANEL_TINT_TEXT; // body text over a PANEL_TINT panel
export let PANEL_TITLE_TEXT = DEFAULT_PALETTE.PANEL_TITLE_TEXT; // title text over a PANEL_TINT title bar
export let SLOT_HIGHLIGHT_COLOR = DEFAULT_PALETTE.SLOT_HIGHLIGHT_COLOR; // active/hover slot highlight
export let CONNECTOR_COLOR = DEFAULT_PALETTE.CONNECTOR_COLOR; // machine<->panel connector curve
export let PROGRESS_BAR_TINT = DEFAULT_PALETTE.PROGRESS_BAR_TINT; // progress bar fill
export let PROGRESS_TEXT_COLOR = DEFAULT_PALETTE.PROGRESS_TEXT_COLOR;
export let PROGRESS_TEXT_STROKE = DEFAULT_PALETTE.PROGRESS_TEXT_STROKE;
export let WORKER_OK_TEXT = DEFAULT_PALETTE.WORKER_OK_TEXT; // staffed machine's status row
export let WORKER_MISSING_TEXT = DEFAULT_PALETTE.WORKER_MISSING_TEXT; // understaffed machine's status row

const themeListeners = [];
let currentTheme = THEME_DEFAULT;

/**
 * @returns {number} the theme in force
 */
export function activeTheme() {
    return currentTheme;
}

/**
 * Swaps the palette. The colors above are live bindings, so anything reading one at paint time
 * gets the new value; already-painted pixels need their layer's restyle().
 * @param {number} themeId
 * @returns {void}
 */
export function applyTheme(themeId) {
    const palette = PALETTES[themeId];
    if (palette === undefined) {
        throw new Error(`Unknown theme id ${themeId}`);
    }
    currentTheme = themeId;
    PANEL_FILL = palette.PANEL_FILL;
    PANEL_FILL_ALPHA = palette.PANEL_FILL_ALPHA;
    PANEL_BORDER = palette.PANEL_BORDER;
    PANEL_TEXT = palette.PANEL_TEXT;
    PANEL_HOVER_FILL = palette.PANEL_HOVER_FILL;
    ACTIVE_ACCENT = palette.ACTIVE_ACCENT;
    LABEL_EMPHASIS = palette.LABEL_EMPHASIS;
    PANEL_TINT = palette.PANEL_TINT;
    SCROLLBAR_TRACK_TINT = palette.SCROLLBAR_TRACK_TINT;
    PANEL_TINT_TEXT = palette.PANEL_TINT_TEXT;
    PANEL_TITLE_TEXT = palette.PANEL_TITLE_TEXT;
    SLOT_HIGHLIGHT_COLOR = palette.SLOT_HIGHLIGHT_COLOR;
    CONNECTOR_COLOR = palette.CONNECTOR_COLOR;
    PROGRESS_BAR_TINT = palette.PROGRESS_BAR_TINT;
    PROGRESS_TEXT_COLOR = palette.PROGRESS_TEXT_COLOR;
    PROGRESS_TEXT_STROKE = palette.PROGRESS_TEXT_STROKE;
    WORKER_OK_TEXT = palette.WORKER_OK_TEXT;
    WORKER_MISSING_TEXT = palette.WORKER_MISSING_TEXT;
    for (const listener of themeListeners) {
        listener(themeId);
    }
}

/**
 * Registers a listener fired after every {@link applyTheme}.
 * @param {function(number): void} listener
 * @returns {function(): void} removes it again
 */
export function onThemeChange(listener) {
    themeListeners.push(listener);
    return () => {
        const index = themeListeners.indexOf(listener);
        if (index >= 0) {
            themeListeners.splice(index, 1);
        }
    };
}

/**
 * The keys every palette must define.
 * @returns {string[]}
 */
export function themedColorNames() {
    return Object.keys(DEFAULT_PALETTE);
}

/**
 * @param {number} themeId
 * @returns {object} that theme's palette
 */
export function palette(themeId) {
    const found = PALETTES[themeId];
    if (found === undefined) {
        throw new Error(`Unknown theme id ${themeId}`);
    }
    return found;
}

/**
 * Whichever of the two text colors reads better on `background`, for controls whose tint the caller
 * chooses (panel buttons, toggle segments).
 * @param {number} background
 * @returns {number}
 */
export function textOn(background) {
    if (contrastRatio(PANEL_TEXT, background) >= contrastRatio(PANEL_TINT_TEXT, background)) {
        return PANEL_TEXT;
    }
    return PANEL_TINT_TEXT;
}

// ---- Layout debug ----
export const DEBUG_OUTLINE_COLOR = 0xff00ff;

// ---- Placement-preview ghost palette (used by every tool's ghost layer) ----
export const GHOST_TINT = 0xFFFFFF;
export const GHOST_ALPHA = 0.9; // ghosts are always semi-transparent
export const GHOST_BLOCKED_TINT = 0xF23030; // placement blocked (red)
export const GHOST_BLOCKED_ALPHA = 0.8;

// ---- Per-tile placement feedback ----
export const BLOCKED_TILE_COLOR = 0xF23030; // red
export const OVERWRITE_TILE_COLOR = 0x3098F2; // blue

// Green marker on the locked placement target tile in center-lock mode: an inset square
// with a semi-transparent fill and an opaque border.
export const TARGET_TILE_COLOR = 0x4CFF50;
export const TARGET_TILE_FILL_ALPHA = 0.22;
export const TARGET_TILE_BORDER_WIDTH = 3;

// Map-mode tint for generic objects.
export const MAP_TILE_COLOR = 0x888888;

// ---- Chunk-claim borders (map/overworld mode) ----
export const CLAIM_FILL_ALPHA = 0.2;
export const CLAIM_BORDER_ALPHA = 0.9;

// ---- Map-mode chunk selection (the chunk panel's target + the cursor square) ----
export const CHUNK_SELECT_COLOR = 0x5bb5ff;
export const CHUNK_SELECT_ALPHA = 0.9;
export const CHUNK_SELECT_FILL_ALPHA = 0.45;
export const CHUNK_HOVER_COLOR = 0x444444; // dark: must read on the white map background
export const CHUNK_HOVER_ALPHA = 0.5;

const CLAIM_COLORS = new Map();

/**
 * A stable, distinct claim color per player, identical on every client: golden-angle hue steps
 * keep neighboring ids far apart on the wheel.
 * @param {number} playerId
 * @returns {number}
 */
export function claimColor(playerId) {
    return getOrCreate(CLAIM_COLORS, playerId, () => {
        const hue = (playerId * 137.508) % 360;
        return new Color({h: hue, s: 70, l: 45}).toNumber();
    });
}

// Saturated, distinct hues chosen to stay legible over belts on the white
// background; pale tints and bright yellows wash out, so they are avoided.
const DEBUG_COLORS = [
    0xe6194b, // red
    0xf58231, // orange
    0x3cb44b, // green
    0x4363d8, // blue
    0x911eb4, // purple
    0xf032e6, // magenta
    0x008080, // teal
    0x9a6324, // brown
    0x800000, // maroon
    0x808000, // olive
    0x000075, // navy
    0xff4500, // orange-red
    0xff1493, // deep pink
    0x1e90ff, // sky blue
    0x32cd32, // lime green
    0x8b008b, // dark magenta
    0xb8860b, // dark goldenrod
    0x2e8b57, // sea green
];

export const DEBUG_COLOR = (n) => DEBUG_COLORS[Number(n) % DEBUG_COLORS.length];
