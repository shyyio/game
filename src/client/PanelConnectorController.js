import {Graphics} from "pixi.js";
import {rectEdgePoint, drawPanelConnector, CONNECTOR_PANEL_INSET} from "@/client/PanelConnector.js";
import {TILE_SIZE} from "@/client/constants.js";

/**
 * Owns one Graphics redrawn every frame with a curve from each registered panel to a world tile.
 */
export class PanelConnectorController {

    /**
     * @param {Application} app
     * @param {ClientViewport|null} [viewport] - set later by the host if not yet available
     */
    constructor(app, viewport = null) {
        this._app = app;
        this.viewport = viewport;
        this.graphics = new Graphics();
        this.graphics.eventMode = "none";
        this._links = new Map();
        this._tick = () => this._draw();
        this._app.ticker.add(this._tick);
    }

    /**
     * Registers (or replaces) a link: a curve from `getPanel()` to the tile from `getTileXY()`; null skips it.
     * @param {string} key
     * @param {function(): (UIPanel|null)} getPanel
     * @param {function(): ({x: number, y: number}|null)} getTileXY
     * @returns {void}
     */
    set(key, getPanel, getTileXY) {
        this._links.set(key, {getPanel, getTileXY});
    }

    /**
     * @param {string} key
     * @returns {void}
     */
    remove(key) {
        this._links.delete(key);
    }

    /**
     * @returns {void}
     */
    destroy() {
        this._app.ticker.remove(this._tick);
        this.graphics.destroy();
        this._links.clear();
    }

    /**
     * @private
     * @returns {void}
     */
    _draw() {
        this.graphics.clear();
        if (this.viewport === null) {
            return;
        }
        for (const {getPanel, getTileXY} of this._links.values()) {
            const panel = getPanel();
            if (panel === null) {
                continue;
            }
            const tile = getTileXY();
            if (tile === null) {
                continue;
            }
            this._drawLink(panel, tile);
        }
    }

    /**
     * The attach points are ray-rect boundary hits (continuous, so they never snap).
     * @private
     * @param {UIPanel} panel
     * @param {{x: number, y: number}} tile
     * @returns {void}
     */
    _drawLink(panel, tile) {
        const tx = tile.x * TILE_SIZE;
        const ty = tile.y * TILE_SIZE;
        const targetRect = {minX: tx, minY: ty, maxX: tx + TILE_SIZE, maxY: ty + TILE_SIZE};
        const targetCenterWorld = {x: tx + TILE_SIZE / 2, y: ty + TILE_SIZE / 2};
        const panelCenterScreen = {x: panel.x + panel.outerWidth / 2, y: panel.y + panel.outerHeight / 2};
        const panelCenterWorld = this.viewport.toWorld(panelCenterScreen.x, panelCenterScreen.y);
        const targetEdge = rectEdgePoint(targetCenterWorld, panelCenterWorld, targetRect);
        const head = this.viewport.toScreen(targetEdge.x, targetEdge.y);

        const panelRect = {
            minX: panel.x + CONNECTOR_PANEL_INSET,
            minY: panel.y + CONNECTOR_PANEL_INSET,
            maxX: panel.x + panel.outerWidth - CONNECTOR_PANEL_INSET,
            maxY: panel.y + panel.outerHeight - CONNECTOR_PANEL_INSET,
        };
        const targetCenterScreen = this.viewport.toScreen(targetCenterWorld.x, targetCenterWorld.y);
        const tail = rectEdgePoint(panelCenterScreen, targetCenterScreen, panelRect);

        drawPanelConnector(this.graphics, tail, head);
    }
}
