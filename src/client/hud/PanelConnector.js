import {CONNECTOR_COLOR} from "@/client/Theme.js";

// A single 1px curve from a HUD panel to its target tile.
const CONNECTOR_ALPHA = 0.5;
// Peak perpendicular bow (fraction of length), reached at a 45° angle; zero when axis-aligned.
const CONNECTOR_BOW = 0.15;
// Bow fades to straight for short curves: 0 below the min length, full above the max (smooth between).
const CONNECTOR_BOW_MIN_LENGTH = 120;
const CONNECTOR_BOW_FULL_LENGTH = 440;
// Inset of the curve's attach point inside the panel rect (screen px).
export const CONNECTOR_PANEL_INSET = 6;

// Smooth 0→1 ramp of `x` across [edge0, edge1].
function smoothstep(edge0, edge1, x) {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
}

/**
 * Where the ray from `center` toward `toward` exits `rect` (its boundary point in that direction).
 * Slides continuously around corners as the direction rotates, so the attach point never snaps.
 * @param {{x: number, y: number}} center
 * @param {{x: number, y: number}} toward
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} rect
 * @returns {{x: number, y: number}}
 */
export function rectEdgePoint(center, toward, rect) {
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    let t = Infinity;
    if (dx > 0) {
        t = Math.min(t, (rect.maxX - center.x) / dx);
    } else if (dx < 0) {
        t = Math.min(t, (rect.minX - center.x) / dx);
    }
    if (dy > 0) {
        t = Math.min(t, (rect.maxY - center.y) / dy);
    } else if (dy < 0) {
        t = Math.min(t, (rect.minY - center.y) / dy);
    }
    if (!Number.isFinite(t)) {
        t = 0;
    }
    return {x: center.x + dx * t, y: center.y + dy * t};
}

/**
 * Draws a curve from `tail` to `head` onto `graphics`, bowed perpendicular by sin(2·angle) of its
 * length so it eases through straight when axis-aligned and never snaps.
 * @param {Graphics} graphics
 * @param {{x: number, y: number}} tail
 * @param {{x: number, y: number}} head
 * @returns {void}
 */
export function drawPanelConnector(graphics, tail, head) {
    const dx = head.x - tail.x;
    const dy = head.y - tail.y;
    const mid = {x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2};
    // Bow proportional to sin(2·angle): straight when axis-aligned, most curved at 45°. Signed, so
    // it eases through zero (no snap) and bows the opposite way past each axis.
    const lengthSq = dx * dx + dy * dy;
    // Also fade to straight for short curves (smoothstep on length).
    const lengthFactor = smoothstep(CONNECTOR_BOW_MIN_LENGTH, CONNECTOR_BOW_FULL_LENGTH, Math.sqrt(lengthSq));
    const bow = lengthSq > 0 ? CONNECTOR_BOW * (2 * dx * dy / lengthSq) * lengthFactor : 0;
    const control = {x: mid.x - dy * bow, y: mid.y + dx * bow};

    graphics
        .moveTo(tail.x, tail.y)
        .quadraticCurveTo(control.x, control.y, head.x, head.y)
        .stroke({width: 1, color: CONNECTOR_COLOR, alpha: CONNECTOR_ALPHA});
}
