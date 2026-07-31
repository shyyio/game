import Mobile from "@/client/Mobile.js";
import Mouse from "@/client/Mouse.js";
import {ViewMode} from "@/client/constants.js";

// Selecting a tool zooms in to at least this scale (a no-op if already past it): on
// mobile, far enough that tiles are large enough to aim the center crosshair; on desktop,
// just past the map-mode threshold (0.25) so a tool is usable without leaving map mode far.
const TOOL_SELECT_ZOOM_MOBILE = 0.7;
const TOOL_SELECT_ZOOM_DESKTOP = 0.4;

/**
 * Derives the effective tool (null when zoomed out to map/overworld mode) from the toolbar
 * selection and view mode, and drives its side effects: ghost/hover reset, rotate-button
 * visibility, pan-freeze (desktop) or center-lock (mobile), and zoom-to-tool on selection.
 */
export class EffectiveToolController {

    /**
     * @param {Client} client
     * @param {ClientViewport} viewport
     * @param {ToolbarLayer} toolbar
     * @param {InputHandler} inputHandler
     */
    constructor(client, viewport, toolbar, inputHandler) {
        this.client = client;
        this.viewport = viewport;
        this.toolbar = toolbar;
        this.inputHandler = inputHandler;
        // Map and overworld mode (zoomed far out) deactivate the active tool without clearing the
        // toolbar selection, so the cursor acts as if nothing were selected and the tool resumes on
        // zoom-in. The effective tool (null when zoomed out) drives the side effects below.
        this.mapMode = false;
    }

    /**
     * Wires the toolbar selection and view-mode change to the effective-tool side effects.
     * @returns {void}
     */
    init() {
        this.toolbar.onChange(() => this._onToolbarChange());
        this.client.onViewModeChange((mode) => {
            const zoomedOut = mode !== ViewMode.WORLD;
            this.inputHandler.setMapMode(zoomedOut);
            this.mapMode = zoomedOut;
            this.applyEffectiveTool();
        });
    }

    /**
     * Applies the effective-tool side effects on both tool changes and map-mode toggles:
     * drop the current ghost/hover, toggle the rotate button, and freeze pan (desktop) or
     * enable center-lock (mobile) while a tool is active.
     * @returns {void}
     */
    applyEffectiveTool() {
        const tool = this.mapMode ? null : this.toolbar.activeTool;
        this.inputHandler.clearToolPreview();
        this.inputHandler.clearInspect();
        this.inputHandler.refreshHover();
        this.client.rotateButtonsLayer.setVisible(tool != null && tool.orientable);
        const mobile = Mobile.enabled;
        // Map mode locks the "cursor" to the screen center too.
        this.client.setCenterLock(mobile && (this.mapMode || (tool != null && tool.usesCenterLock)));
        if (mobile) {
            return;
        }
        if (tool != null) {
            this.viewport.freezePan();
        } else {
            this.viewport.unfreezePan();
        }
    }

    /**
     * Selecting a toolbar tool zooms in. On desktop the zoom homes on the mouse cursor.
     * @private
     * @returns {void}
     */
    _onToolbarChange() {
        this.applyEffectiveTool();
        const mobile = Mobile.enabled;
        const target = mobile ? TOOL_SELECT_ZOOM_MOBILE : TOOL_SELECT_ZOOM_DESKTOP;
        if (this.toolbar.activeTool == null || this.viewport.scale.x >= target) {
            return;
        }
        if (!mobile && Mouse.currentX != null) {
            const ratio = this.viewport.scale.x / target;
            this.viewport.glideTo({
                x: Mouse.currentX - (Mouse.currentX - this.viewport.center.x) * ratio,
                y: Mouse.currentY - (Mouse.currentY - this.viewport.center.y) * ratio,
                scale: target,
            });
            return;
        }
        this.viewport.glideTo({scale: target});
    }

}
