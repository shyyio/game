// The mod's HUD glyphs; each paints around (0, 0), like the engine's own icons.

// Credits read as coin gold, not as another line of black text.
export const COIN_COLOR = 0xC8901E;

// The coin's outer and inner rings.
const COIN_ICON_RADIUS = 7;
const COIN_ICON_INNER_RADIUS = 3;

/**
 * The credits icon: a coin, ringed.
 * @param {Graphics} face
 * @param {number} color
 * @param {number} width
 * @returns {void}
 */
export function drawCoinIcon(face, color, width) {
    face
        .circle(0, 0, COIN_ICON_RADIUS)
        .stroke({color, width})
        .circle(0, 0, COIN_ICON_INNER_RADIUS)
        .stroke({color, width});
}
