import {
    KEYBINDING_PAN_UP,
    KEYBINDING_PAN_LEFT,
    KEYBINDING_PAN_DOWN,
    KEYBINDING_PAN_RIGHT,
} from "@/common/KeybindingEntry.js";

/**
 * A rebindable pan action, and the screen direction it moves the view.
 */
export class PanDirectionEntry {

    /**
     * @param {KeybindingEntry} keybinding
     * @param {number} x
     * @param {number} y
     */
    constructor(keybinding, x, y) {
        this.keybinding = keybinding;
        this.x = x;
        this.y = y;
    }
}

// Screen pixels a held key pans per second.
export const PAN_SPEED = 1200;

export const PAN_DIRECTIONS = [
    new PanDirectionEntry(KEYBINDING_PAN_UP, 0, -1),
    new PanDirectionEntry(KEYBINDING_PAN_LEFT, -1, 0),
    new PanDirectionEntry(KEYBINDING_PAN_DOWN, 0, 1),
    new PanDirectionEntry(KEYBINDING_PAN_RIGHT, 1, 0),
];

/**
 * The world-pixel offset a frame's held directions pan the view by: screen distance divided by
 * the zoom, so a diagonal travels an axis's distance and opposed directions cancel.
 * @param {Set<PanDirectionEntry>} heldDirections
 * @param {number} deltaMS
 * @param {number} scale - the viewport's zoom
 * @returns {Point}
 */
export function keyboardPanOffset(heldDirections, deltaMS, scale) {
    let x = 0;
    let y = 0;
    for (const entry of heldDirections) {
        x += entry.x;
        y += entry.y;
    }
    if (x === 0 && y === 0) {
        return {x: 0, y: 0};
    }
    const distance = PAN_SPEED * deltaMS / 1000 / scale / Math.hypot(x, y);
    return {x: x * distance, y: y * distance};
}
