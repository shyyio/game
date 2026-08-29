/**
 * The stacking order of the HUD, front to back. Every layer added to the pixi stage takes its
 * `zIndex` from here rather than stamping a number, so the whole order reads in one place.
 *
 * Layers sharing a band are drawn in the order they are added to the stage, pixi's sort being
 * stable. That is deliberate for {@link HudLayer.PANEL}: any number of panels, mod-contributed ones
 * included, sit at one height, and which of two overlapping panels wins is the mount order.
 * @enum
 */
export const HudLayer = {

    /**
     * The build watermark, behind every other HUD element.
     */
    WATERMARK: 100,

    /**
     * Markers drawn over the world rather than over the HUD (the center crosshair).
     */
    WORLD_MARKER: 800,

    /**
     * Standing on-screen controls: the map buttons and the counter list.
     */
    CONTROL: 900,

    /**
     * The rotate buttons, which sit over the other standing controls.
     */
    ROTATE_CONTROL: 1000,

    /**
     * The docked top and bottom bars.
     */
    EDGE_BAR: 9000,

    /**
     * Circular overlay buttons.
     */
    OVERLAY_BUTTON: 9500,

    /**
     * Tooltips describing whatever the cursor rests on, which have to clear the buttons and
     * counters they describe. A tooltip parented to a panel instead of the stage is ranked against
     * that panel's own children, where this still puts it over the panel body.
     */
    TOOLTIP: 9550,

    /**
     * Panels: inspect, config, chunk administration, and every mod's own.
     */
    PANEL: 9600,

    /**
     * The status message strip, over the panels.
     */
    STATUS: 10000,

    /**
     * Toasts.
     */
    NOTICE: 11000,

    /**
     * Modal dialogs, over everything.
     */
    DIALOG: 12000,
};

// The DOM elements overlaid on the canvas (text inputs, selectable text) share one stacking
// context above it; the pixi bands above say nothing about these, which the browser stacks.
export const HUD_DOM_Z_INDEX = "1000";
