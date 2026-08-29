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
        .moveTo(-9, 2)
        .arc(-3, 2, 6, Math.PI, 0, false)
        .stroke({color, width});
    face
        .moveTo(-3, 2)
        .arc(3, 2, 6, Math.PI, 0, false)
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
 * The production button's icon: an ascending 3-bar chart.
 * @param {Graphics} face
 * @param {number} [color]
 * @param {number} [width]
 * @returns {void}
 */
export function drawChartIcon(face, color = PANEL_TEXT, width = ICON_STROKE) {
    const baseline = 8;
    const bars = [{x: -7, height: 8}, {x: 0, height: 13}, {x: 7, height: 18}];
    for (const bar of bars) {
        face
            .moveTo(bar.x, baseline)
            .lineTo(bar.x, baseline - bar.height)
            .stroke({color, width, cap: "round"});
    }
}

/**
 * The art icon: a paintbrush, handle top-right to tip bottom-left.
 * @param {Graphics} face
 * @param {number} [color]
 * @param {number} [width]
 * @returns {void}
 */
export function drawBrushIcon(face, color = PANEL_TEXT, width = ICON_STROKE) {
    face
        .moveTo(9, -9)
        .lineTo(-2, 2)
        .stroke({color, width, cap: "round"});
    face
        .moveTo(-2, 2)
        .lineTo(-5, 7)
        .lineTo(-9, 9)
        .lineTo(-7, 5)
        .lineTo(-2, 2)
        .fill({color});
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

/**
 * The terrain icon: a two-peak mountain range.
 * @param {Graphics} face
 * @param {number} [color]
 * @param {number} [width]
 * @returns {void}
 */
export function drawMountainIcon(face, color = PANEL_TEXT, width = ICON_STROKE) {
    face
        .poly([-11, 8, -4, -7, 1, 1, 4, -3, 11, 8], true)
        .stroke({color, width, join: "round"});
}
