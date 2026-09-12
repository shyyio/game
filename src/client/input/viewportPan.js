/**
 * A key that pans the viewport, and the screen direction it moves the view.
 */
class PanKeyEntry {

    /**
     * @param {string} key
     * @param {number} x
     * @param {number} y
     */
    constructor(key, x, y) {
        this.key = key;
        this.x = x;
        this.y = y;
    }
}

// Screen pixels a held key pans per second.
export const PAN_SPEED = 1200;

export const PAN_KEYS = [
    new PanKeyEntry("w", 0, -1),
    new PanKeyEntry("a", -1, 0),
    new PanKeyEntry("s", 0, 1),
    new PanKeyEntry("d", 1, 0),
];

/**
 * The world-pixel offset a frame's held keys pan the view by: screen distance divided by the
 * zoom, so a diagonal travels an axis's distance and opposed keys cancel.
 * @param {Set<string>} heldKeys
 * @param {number} deltaMS
 * @param {number} scale - the viewport's zoom
 * @returns {Point}
 */
export function keyboardPanOffset(heldKeys, deltaMS, scale) {
    let x = 0;
    let y = 0;
    for (const entry of PAN_KEYS) {
        if (heldKeys.has(entry.key)) {
            x += entry.x;
            y += entry.y;
        }
    }
    if (x === 0 && y === 0) {
        return {x: 0, y: 0};
    }
    const distance = PAN_SPEED * deltaMS / 1000 / scale / Math.hypot(x, y);
    return {x: x * distance, y: y * distance};
}
