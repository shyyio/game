import {UIPanel} from "@/client/hud/UIPanel.js";
import {InspectContent, inspectContentHeight} from "@/client/hud/InspectContent.js";
import {SlotTooltip} from "@/client/hud/SlotTooltip.js";
import {PANEL_TINT, PANEL_TITLE_TEXT} from "@/client/Theme.js";
import {EMPTY} from "@/sim/sentinels.js";
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
        const objects = cache.view("objects");
        cache.subscribe("inspect.heartbeatByObject", (objectRef, heartbeat) => {
            if (heartbeat === undefined) {
                this.remove(objectRef);
            } else {
                const entry = objects.get(objectRef);
                let machineTile = undefined;
                let title = `Machine #${objectRef}`;
                let lastProduced = undefined;
                if (entry !== null) {
                    machineTile = {x: entry.tileX, y: entry.tileY};
                    title = entry.data.type.label;
                    // The synced last output of a producer; EMPTY before its first delivery.
                    if (entry.data.lastOutput !== undefined && entry.data.lastOutput !== EMPTY) {
                        lastProduced = entry.data.lastOutput;
                    }
                }
                this.update(heartbeat, lastProduced, machineTile, title);
            }
        });
        /**
         * @type {TextureCache|null}
         */
        this.textureCache = null;
        /**
         * Item definitions, for drawing item icons (set by the host before any panel opens).
         * @type {ItemRegistry|null}
         */
        this.items = null;
        this._onClose = null;
        // objectRef string -> InspectPanelRecord.
        this._panels = new Map();
        // The hovered slot's item name, above every panel.
        this._tooltip = new SlotTooltip(app);
        this.addChild(this._tooltip);
    }

    /**
     * Registers the callback invoked with an object ref when a panel's close button is pressed.
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
     * @param {string} title - the machine's object type label
     */
    update(event, lastProduced, machineTile, title) {
        const key = String(event.objectRef);
        let record = this._panels.get(key);
        if (record === undefined) {
            // Height comes from the first snapshot (workerCost is a type constant, so a worker row never appears later).
            const panel = this._createPanel(event.objectRef, UIPanel.heightForContent(inspectContentHeight(event)), title);
            const content = new InspectContent(event, panel.contentWidth, this.textureCache, this.items, this._tooltip);
            panel.addContent(content);
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
     * @param {number} objectRef
     */
    remove(objectRef) {
        const key = String(objectRef);
        const record = this._panels.get(key);
        if (record === undefined) {
            return;
        }
        record.panel.destroy({children: true});
        this._panels.delete(key);
        this._connectors.remove(key);
    }

    /**
     * @param {number} objectRef
     * @param {number} height - the panel's outer height for this machine's content
     * @param {string} title
     * @returns {UIPanel}
     * @private
     */
    _createPanel(objectRef, height, title) {
        const index = this._panels.size;
        const panel = new UIPanel({
            app: this._app,
            textureCache: this.textureCache,
            title,
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width: PANEL_WIDTH,
            height,
            onClose: () => {
                if (this._onClose !== null) {
                    this._onClose(objectRef);
                }
            },
        });
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
