import {Container, Graphics} from "pixi.js";
import {UIPanel} from "@/client/UIPanel.js";
import {buildInspectContent, inspectContentHeight} from "@/client/InspectContent.js";
import {PANEL_TINT, PANEL_TITLE_TEXT} from "@/client/Theme.js";
import {TILE_SIZE} from "@/client/constants.js";
import {rectEdgePoint, drawPanelConnector, CONNECTOR_PANEL_INSET} from "@/client/PanelConnector.js";

const PANEL_WIDTH = 375;
// Down-right cascade of each successive panel's default spawn position.
const SPAWN_CASCADE = 32;
// Keep a spawned panel at least this far inside the screen edges.
const SPAWN_MARGIN = 12;

/**
 * HUD of floating, draggable {@link UIPanel}s — one per inspected machine. Owns the collection,
 * placement, and drag; each panel's body content is filled elsewhere.
 */
export class InspectPanelLayer extends Container {

    /**
     * @param {Application} app
     * @param {ClientCache} cache
     */
    constructor(app, cache) {
        super();
        this._app = app;
        // Above the always-visible settings/friends buttons (9500), below toasts/dialogs.
        this.zIndex = 9600;
        const objects = cache.view("objects");
        cache.subscribe("inspect.heartbeatByObject", (objectId, heartbeat) => {
            if (heartbeat === undefined) {
                this.remove(objectId);
            } else {
                const entry = objects.get(objectId);
                const machineTile = entry === null ? undefined : {x: entry.tileX, y: entry.tileY};
                this.update(heartbeat, objects.lastProducedOf(objectId), machineTile);
            }
        });
        /**
         * @type {TextureRegistry|null}
         */
        this.textureRegistry = null;
        /**
         * Item type -> texture name, for drawing item icons.
         * @type {Object<number, string>}
         */
        this.itemTextures = {};
        this._onClose = null;
        // objectId string -> {panel, position}.
        this._panels = new Map();
        this.debug = false;
        // The game viewport, for mapping a machine's world position to the screen (set by the host).
        this.viewport = null;
        // Connector curves, drawn behind the panels and redrawn each frame.
        this._connectors = new Graphics();
        this._connectors.eventMode = "none";
        this.addChild(this._connectors);
        this._app.ticker.add(() => this._drawConnector());
    }

    /**
     * Toggles the debug element outlines on every open panel.
     * @param {boolean} on
     * @returns {void}
     */
    setDebug(on) {
        this.debug = on;
        for (const record of this._panels.values()) {
            record.panel.setDebug(on);
        }
    }

    /**
     * Registers the callback invoked with an object id when a panel's close button is pressed.
     * @param {function(number): void} callback
     */
    onClose(callback) {
        this._onClose = callback;
    }

    /**
     * Opens the panel for a machine (once); later heartbeats keep it alive.
     * @param {InspectHeartbeatState} event
     * @param {number|undefined} lastProduced - the machine's last produced item, for the output fallback
     * @param {{x: number, y: number}|undefined} machineTile - the machine's tile position, for the connectors
     */
    update(event, lastProduced, machineTile) {
        const key = String(event.objectId);
        let record = this._panels.get(key);
        if (record === undefined) {
            // The panel's height comes from the first snapshot (a worker row never appears later:
            // workerCost is a type constant).
            record = this._createPanel(event.objectId, UIPanel.heightForContent(inspectContentHeight(event)));
            this._panels.set(key, record);
        }
        record.position = machineTile;

        // Rebuild the body from the latest snapshot.
        record.panel.clearContent();
        buildInspectContent(record.panel, event, this.textureRegistry, this.itemTextures, lastProduced);
        if (this.debug) {
            record.panel.setDebug(true);
        }
    }

    /**
     * Removes a machine's panel (its menu closed or the machine was deleted).
     * @param {number} objectId
     */
    remove(objectId) {
        const key = String(objectId);
        const record = this._panels.get(key);
        if (record === undefined) {
            return;
        }
        record.panel.destroy({children: true});
        this._panels.delete(key);
    }

    /**
     * @param {number} objectId
     * @param {number} height - the panel's outer height for this machine's content
     * @returns {object} the panel record
     * @private
     */
    _createPanel(objectId, height) {
        const index = this._panels.size;
        const panel = new UIPanel({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: `Machine #${objectId}`,
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width: PANEL_WIDTH,
            height,
            onClose: () => {
                if (this._onClose !== null) {
                    this._onClose(objectId);
                }
            },
        });
        panel.setDebug(this.debug);
        // First panel opens centered; subsequent cascade down-right, zig-zagging back before they'd
        // spill off-screen (Windows-XP style). Each axis zig-zags independently, so the roomier axis
        // still separates panels when the other is too tight to cascade (e.g. narrow mobile).
        const screen = this._app.screen;
        const maxX = screen.width - PANEL_WIDTH - SPAWN_MARGIN;
        const maxY = screen.height - height - SPAWN_MARGIN;
        panel.x = this._cascadeAxis((screen.width - PANEL_WIDTH) / 2, maxX, index);
        panel.y = this._cascadeAxis((screen.height - height) / 2, maxY, index);
        this.addChild(panel);
        return {panel, height};
    }

    /**
     * One axis of the zig-zag spawn cascade: starts centered, steps by SPAWN_CASCADE, bounces back
     * before passing `max`, and clamps within the screen when the panel barely fits.
     * @param {number} center
     * @param {number} max
     * @param {number} index
     * @returns {number}
     * @private
     */
    _cascadeAxis(center, max, index) {
        const base = Math.min(Math.max(center, SPAWN_MARGIN), Math.max(max, SPAWN_MARGIN));
        const range = Math.max(1, Math.floor((max - base) / SPAWN_CASCADE));
        const phase = index % (2 * range);
        const step = phase <= range ? phase : 2 * range - phase;
        return base + step * SPAWN_CASCADE;
    }

    /**
     * Redraws a single curve from each panel to its machine. The attach points are ray-rect boundary
     * hits (continuous, so they never snap). Runs every frame (world/panel move).
     * @returns {void}
     * @private
     */
    _drawConnector() {
        this._connectors.clear();
        if (this.viewport === null) {
            return;
        }
        for (const record of this._panels.values()) {
            if (record.position === undefined) {
                continue;
            }
            const panel = record.panel;

            // Machine attach point: rect edge toward the panel, in world px (inset scales with zoom).
            const tx = record.position.x * TILE_SIZE;
            const ty = record.position.y * TILE_SIZE;
            const machineRect = {
                minX: tx,
                minY: ty,
                maxX: tx + TILE_SIZE,
                maxY: ty + TILE_SIZE,
            };
            const machineCenterWorld = {x: tx + TILE_SIZE / 2, y: ty + TILE_SIZE / 2};
            const panelCenterScreen = {x: panel.x + PANEL_WIDTH / 2, y: panel.y + record.height / 2};
            const panelCenterWorld = this.viewport.toWorld(panelCenterScreen.x, panelCenterScreen.y);
            const machineEdge = rectEdgePoint(machineCenterWorld, panelCenterWorld, machineRect);
            const head = this.viewport.toScreen(machineEdge.x, machineEdge.y);

            // Panel attach point: rect edge toward the machine, in screen px.
            const panelRect = {
                minX: panel.x + CONNECTOR_PANEL_INSET,
                minY: panel.y + CONNECTOR_PANEL_INSET,
                maxX: panel.x + PANEL_WIDTH - CONNECTOR_PANEL_INSET,
                maxY: panel.y + record.height - CONNECTOR_PANEL_INSET,
            };
            const machineCenterScreen = this.viewport.toScreen(machineCenterWorld.x, machineCenterWorld.y);
            const tail = rectEdgePoint(panelCenterScreen, machineCenterScreen, panelRect);

            drawPanelConnector(this._connectors, tail, head);
        }
    }
}
