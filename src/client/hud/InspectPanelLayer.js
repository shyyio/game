import {UIPanel} from "@/client/hud/UIPanel.js";
import {InspectContent, inspectContentHeight} from "@/client/hud/InspectContent.js";
import {SlotTooltip} from "@/client/hud/SlotTooltip.js";
import {PANEL_TINT, PANEL_TITLE_TEXT} from "@/client/Theme.js";
import {ConnectedPanelLayer} from "@/client/hud/ConnectedPanelLayer.js";

const PANEL_WIDTH = 375;
// Down-right cascade of each successive panel's default spawn position.
const SPAWN_CASCADE = 32;
// Keep a spawned panel at least this far inside the screen edges.
const SPAWN_MARGIN = 12;

/**
 * HUD of floating, draggable {@link UIPanel}s, one per inspected machine; body content filled elsewhere.
 */
export class InspectPanelLayer extends ConnectedPanelLayer {

    /**
     * @param {Application} app
     * @param {ClientCache} cache
     */
    constructor(app, cache) {
        super(app);
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
         * Item definitions, for drawing item icons (set by the host before any panel opens).
         * @type {ItemRegistry|null}
         */
        this.items = null;
        this._onClose = null;
        // objectId string -> InspectPanelRecord.
        this._panels = new Map();
        // The hovered slot's item name, above every panel.
        this._tooltip = new SlotTooltip(app);
        this.addChild(this._tooltip);
        this.debug = false;
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
            // Height comes from the first snapshot (workerCost is a type constant, so a worker row never appears later).
            const panel = this._createPanel(event.objectId, UIPanel.heightForContent(inspectContentHeight(event)));
            const content = new InspectContent(event, panel.contentWidth, this.textureRegistry, this.items, this._tooltip);
            panel.addContent(content);
            // Outlines snapshot the children, so they are drawn once the body is in.
            panel.setDebug(this.debug);
            record = new InspectPanelRecord(panel, content);
            this._panels.set(key, record);
            this._connectors.set(key, () => record.panel, () => {
                if (record.position === undefined) {
                    return null;
                }
                return record.position;
            });
        }
        record.position = machineTile;
        record.content.update(event, lastProduced);
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        for (const record of this._panels.values()) {
            record.panel.restyle(PANEL_TINT, PANEL_TITLE_TEXT);
            record.content.restyle();
        }
        this._tooltip.restyle();
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
        this._connectors.remove(key);
    }

    /**
     * @param {number} objectId
     * @param {number} height - the panel's outer height for this machine's content
     * @returns {UIPanel}
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
        // First panel centered; rest cascade down-right, zig-zagging back before off-screen (per axis).
        const screen = this._app.screen;
        const maxX = screen.width - PANEL_WIDTH - SPAWN_MARGIN;
        const maxY = screen.height - height - SPAWN_MARGIN;
        panel.x = this._cascadeAxis((screen.width - PANEL_WIDTH) / 2, maxX, index);
        panel.y = this._cascadeAxis((screen.height - height) / 2, maxY, index);
        this.addChild(panel);
        return panel;
    }

    /**
     * One axis of the zig-zag spawn cascade, clamped within the screen.
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
}

/**
 * One open machine's panel: its body content and the machine tile its connector points at.
 */
class InspectPanelRecord {

    /**
     * @param {UIPanel} panel
     * @param {InspectContent} content
     */
    constructor(
        panel,
        content,
    ) {
        this.panel = panel;
        this.content = content;
        /**
         * @type {{x: number, y: number}|undefined}
         */
        this.position = undefined;
    }
}
