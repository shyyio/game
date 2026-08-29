// Tap-target sizes, in one place and all scaled together, so an accessibility "big UI" setting is
// a single multiplier rather than an edit to every widget. Mirrors Theme: importers see the new
// value through the live binding, but already-painted pixels need their layer's restyle().

export const UI_SCALE_NORMAL = 1;
// Big UI clears WCAG 2.5.5 (44px targets) on every control; the smallest target sets the floor.
export const UI_SCALE_BIG = 1.6;
// The slider's range: never below the normal size, never past what clears AAA.
export const UI_SCALE_MIN = UI_SCALE_NORMAL;
export const UI_SCALE_MAX = UI_SCALE_BIG;
export const UI_SCALE_STEP = 0.1;

// The unscaled sizes. Each is a target a pointer has to hit, so each is audited.
const BASE = {
    // A panel button's height, which is also a panel row's.
    BUTTON_HEIGHT: 34,
    // The round overlay buttons (settings, friends, rotate, map).
    CIRCLE_BUTTON_RADIUS: 24,
    // One cell of the icon picker grid.
    ICON_CELL_SIZE: 44,
    // A panel's title-bar close button, the smallest target and so the one setting UI_SCALE_BIG.
    CLOSE_SIZE: 28,
    // A toolbar slot.
    TOOLBAR_SLOT_SIZE: 56,
    // Spacing between items in a row, and one step of row nesting; scaled so a bigger UI is not
    // just bigger controls packed as tightly.
    ROW_GAP: 6,
    ROW_INDENT: 16,
};

export let BUTTON_HEIGHT = BASE.BUTTON_HEIGHT;
export let CIRCLE_BUTTON_RADIUS = BASE.CIRCLE_BUTTON_RADIUS;
export let ICON_CELL_SIZE = BASE.ICON_CELL_SIZE;
export let CLOSE_SIZE = BASE.CLOSE_SIZE;
export let TOOLBAR_SLOT_SIZE = BASE.TOOLBAR_SLOT_SIZE;
export let ROW_GAP = BASE.ROW_GAP;
export let ROW_INDENT = BASE.ROW_INDENT;

let current = UI_SCALE_NORMAL;
const scaleListeners = [];

/**
 * @returns {number} the scale currently applied
 */
export function uiScale() {
    return current;
}

/**
 * Registers a listener fired after every scale change, for repainting and relaying out.
 * @param {function(): void} listener
 * @returns {function(): void} unsubscribe
 */
export function onUiScaleChange(listener) {
    scaleListeners.push(listener);
    return () => {
        const index = scaleListeners.indexOf(listener);
        if (index >= 0) {
            scaleListeners.splice(index, 1);
        }
    };
}

/**
 * Rescales every tap target. The caller repaints: a layer's restyle() redraws at the new size.
 * @param {number} scale
 * @returns {void}
 */
export function applyUiScale(scale) {
    current = scale;
    BUTTON_HEIGHT = Math.round(BASE.BUTTON_HEIGHT * scale);
    CIRCLE_BUTTON_RADIUS = Math.round(BASE.CIRCLE_BUTTON_RADIUS * scale);
    ICON_CELL_SIZE = Math.round(BASE.ICON_CELL_SIZE * scale);
    CLOSE_SIZE = Math.round(BASE.CLOSE_SIZE * scale);
    TOOLBAR_SLOT_SIZE = Math.round(BASE.TOOLBAR_SLOT_SIZE * scale);
    ROW_GAP = Math.round(BASE.ROW_GAP * scale);
    ROW_INDENT = Math.round(BASE.ROW_INDENT * scale);
    for (const listener of scaleListeners) {
        listener();
    }
}

/**
 * Every tap target by name, at the scale currently applied: what the accessibility audit walks.
 * A circular control is measured by its diameter, the square its finger has to land in.
 * @returns {Array<{where: string, width: number, height: number}>}
 */
export function tapTargets() {
    return [
        {where: "panel button", width: BUTTON_HEIGHT, height: BUTTON_HEIGHT},
        {where: "circle overlay button", width: CIRCLE_BUTTON_RADIUS * 2, height: CIRCLE_BUTTON_RADIUS * 2},
        {where: "icon picker cell", width: ICON_CELL_SIZE, height: ICON_CELL_SIZE},
        {where: "panel close button", width: CLOSE_SIZE, height: CLOSE_SIZE},
        {where: "toolbar slot", width: TOOLBAR_SLOT_SIZE, height: TOOLBAR_SLOT_SIZE},
    ];
}
