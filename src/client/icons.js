import {PANEL_TEXT} from "@/client/Theme.js";

// Vector HUD glyphs shared by the map buttons and world markers; each paints around (0, 0).

export const ICON_STROKE = 2.5;

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

/**
 * The only-me badge: a closed padlock.
 * @param {Graphics} face
 * @param {number} [color]
 * @param {number} [width]
 * @returns {void}
 */
export function drawLockIcon(face, color = PANEL_TEXT, width = ICON_STROKE) {
    face
        .moveTo(-4, -3)
        .arc(0, -3, 4, Math.PI, 0, false)
        .stroke({color, width});
    face
        .rect(-6, -1, 12, 8)
        .stroke({color, width});
}

/**
 * The friend-access badge: two overlapping head-and-shoulders glyphs.
 * @param {Graphics} face
 * @param {number} [color]
 * @param {number} [width]
 * @returns {void}
 */
export function drawFriendIcon(face, color = PANEL_TEXT, width = ICON_STROKE) {
    face
        .circle(-3, -5, 3)
        .stroke({color, width});
    face
        .circle(3, -5, 3)
        .stroke({color, width});
    face
        .moveTo(-9, 6)
        .arc(-3, 2, 6, Math.PI, 0, true)
        .stroke({color, width});
    face
        .moveTo(-3, 6)
        .arc(3, 2, 6, Math.PI, 0, true)
        .stroke({color, width});
}

/**
 * The friends button's icon: a smiley face.
 * @param {Graphics} face
 * @param {number} [color]
 * @param {number} [width]
 * @returns {void}
 */
export function drawSmileyIcon(face, color = PANEL_TEXT, width = ICON_STROKE) {
    face
        .circle(0, 0, 10)
        .stroke({color, width});
    face
        .circle(-4, -3, 1.4)
        .fill({color});
    face
        .circle(4, -3, 1.4)
        .fill({color});
    face
        .moveTo(-5, 2)
        .quadraticCurveTo(0, 7, 5, 2)
        .stroke({color, width, cap: "round"});
}

/**
 * The settings icon: three sliders, each a horizontal line with a knob.
 * @param {Graphics} face
 * @returns {void}
 */
export function drawSettingsIcon(face) {
    const halfWidth = 9;
    const rows = [-7, 0, 7];
    const knobX = [-3, 4, -4];
    for (const y of rows) {
        face
            .moveTo(-halfWidth, y)
            .lineTo(halfWidth, y)
            .stroke({color: PANEL_TEXT, width: ICON_STROKE, cap: "round"});
    }
    for (const [i, y] of rows.entries()) {
        face.circle(knobX[i], y, 2.5).fill({color: PANEL_TEXT});
    }
}
