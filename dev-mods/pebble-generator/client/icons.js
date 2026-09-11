// The mod's HUD glyphs; each paints around (0, 0), like the engine's own icons.

export const PEBBLE_COLOR = 0x9A9A9A;

/**
 * The generator counter's icon: a pebble.
 * @param {Graphics} face
 * @param {number} color
 * @param {number} width
 * @returns {void}
 */
export function drawPebbleIcon(face, color, width) {
    face
        .ellipse(0, 0, 7, 5)
        .stroke({color, width});
}
