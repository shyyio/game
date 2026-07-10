// Central color palette for all client-side (pixi) rendering. Mods keep their own
// domain palettes; this holds shared HUD/chrome colors and engine render colors.

// ---- HUD panel chrome (mini-menu, rotate buttons, status message) ----
export const PANEL_FILL = 0x1a1a1a;
export const PANEL_FILL_ALPHA = 0.92;
export const PANEL_BORDER = 0x555555;
export const PANEL_TEXT = 0xffffff;
export const PANEL_HOVER_FILL = 0x5a5a5a;

// ---- Accents ----
export const ACTIVE_ACCENT = 0x5bb5ff; // pressed/active control highlight
export const LABEL_EMPHASIS = 0xffd24a;

export const TOOLBAR_TEXT = 0x000000;

// ---- Inspect & toolbar panels (ui_flat frame chrome) ----
export const PANEL_TINT = 0xeee6d8; // warm-gray tint over the ui_flat frame
export const PANEL_TITLE_TEXT = 0xffffff;
export const SLOT_HIGHLIGHT_COLOR = 0x9be89b; // active/hover slot highlight (green)
export const CONNECTOR_COLOR = 0x000000; // machine<->panel connector curve
export const PROGRESS_BAR_TINT = 0x81ff08; // progress bar fill (green)
export const PROGRESS_TEXT_COLOR = 0xffffff;
export const PROGRESS_TEXT_STROKE = 0x111111;

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
