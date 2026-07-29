import {PANEL_FILL, PANEL_FILL_ALPHA, PANEL_BORDER, PANEL_TEXT} from "@/client/Theme.js";

// Vector HUD glyphs shared by the map buttons and world markers; each paints around (0, 0).

export const ICON_STROKE = 2.5;

/**
 * The shared HUD panel background: a rounded panel-chrome rect at (0, 0).
 * @param {Graphics} graphics
 * @param {number} width
 * @param {number} height
 * @returns {void}
 */
export function drawPanelBackground(graphics, width, height) {
    graphics
        .roundRect(0, 0, width, height, 6)
        .fill({color: PANEL_FILL, alpha: PANEL_FILL_ALPHA})
        .stroke({color: PANEL_BORDER, width: 1});
}

/**
 * The claim-selection icon: a 2x2 chunk grid.
 * @param {Graphics} face
 * @returns {void}
 */
export function drawClaimIcon(face) {
    const cell = 8;
    const gap = 3;
    const offset = cell + gap / 2;
    face
        .rect(-offset, -offset, cell, cell)
        .rect(gap / 2, -offset, cell, cell)
        .rect(-offset, gap / 2, cell, cell)
        .rect(gap / 2, gap / 2, cell, cell)
        .stroke({color: PANEL_TEXT, width: ICON_STROKE});
}

/**
 * The home icon: a house outline.
 * @param {Graphics} face
 * @param {number} [color]
 * @param {number} [width]
 * @returns {void}
 */
export function drawHomeIcon(face, color = PANEL_TEXT, width = ICON_STROKE) {
    face
        .moveTo(-10, 1)
        .lineTo(0, -9)
        .lineTo(10, 1)
        .stroke({color, width, join: "round", cap: "round"});
    face
        .rect(-7, 1, 14, 9)
        .stroke({color, width});
}
