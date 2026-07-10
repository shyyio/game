import {Container, Graphics} from "pixi.js";
import {UIPanel} from "@/client/UIPanel.js";
import {buildInspectContent, INSPECT_CONTENT_HEIGHT} from "@/client/InspectContent.js";
import {PANEL_TINT, PANEL_TITLE_TEXT, CONNECTOR_COLOR} from "@/client/Theme.js";
import {TILE_SIZE} from "@/client/constants.js";

const PANEL_WIDTH = 375;
const PANEL_HEIGHT = UIPanel.heightForContent(INSPECT_CONTENT_HEIGHT);
// Down-right cascade of each successive panel's default spawn position.
const SPAWN_CASCADE = 32;
// Keep a spawned panel at least this far inside the screen edges.
const SPAWN_MARGIN = 12;

// A single 1px curve from the panel to its machine.
const CONNECTOR_ALPHA = 0.5;
// Peak perpendicular bow (fraction of length), reached at a 45° angle; zero when axis-aligned.
const CONNECTOR_BOW = 0.15;
// Bow fades to straight for short curves: 0 below the min length, full above the max (smooth between).
const CONNECTOR_BOW_MIN_LENGTH = 120;
const CONNECTOR_BOW_FULL_LENGTH = 440;
// Inset of the curve's attach point inside the panel rect (screen px).
const CONNECTOR_PANEL_INSET = 6;

// Smooth 0→1 ramp of `x` across [edge0, edge1].
function smoothstep(edge0, edge1, x) {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
}

// Where the ray from `center` toward `toward` exits `rect` (its boundary point in that direction).
// Slides continuously around corners as the direction rotates, so the attach point never snaps.
function rectEdgePoint(center, toward, rect) {
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    let t = Infinity;
    if (dx > 0) {
        t = Math.min(t, (rect.maxX - center.x) / dx);
    } else if (dx < 0) {
        t = Math.min(t, (rect.minX - center.x) / dx);
    }
    if (dy > 0) {
        t = Math.min(t, (rect.maxY - center.y) / dy);
    } else if (dy < 0) {
        t = Math.min(t, (rect.minY - center.y) / dy);
    }
    if (!Number.isFinite(t)) {
        t = 0;
    }
    return {x: center.x + dx * t, y: center.y + dy * t};
}

/**
 * HUD of floating, draggable {@link UIPanel}s — one per inspected machine. Owns the collection,
 * placement, and drag; each panel's body content is filled elsewhere.
 */
export class InspectPanelLayer extends Container {

    /**
     * @param {Application} app
     */
    constructor(app) {
        super();
        this._app = app;
        this.textureRegistry = null;
        // Item type -> texture name, for drawing item icons.
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
        this._panels.forEach(record => record.panel.setDebug(on));
    }

    /**
     * Registers the callback invoked with an object id when a panel's close button is pressed.
     * @param {function(BigInt): void} callback
     */
    onClose(callback) {
        this._onClose = callback;
    }

    /**
     * Opens the panel for a machine (once); later heartbeats keep it alive.
     * @param {InspectHeartbeatEvent} event
     * @param {number|undefined} lastProduced - the machine's last produced item, for the output fallback
     * @param {{x: number, y: number}|undefined} machineTile - the machine's tile position, for the connectors
     */
    update(event, lastProduced, machineTile) {
        const key = String(event.objectId);
        let record = this._panels.get(key);
        if (record === undefined) {
            record = this._createPanel(event.objectId);
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
     * @param {BigInt} objectId
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
     * @param {BigInt} objectId
     * @returns {object} the panel record
     * @private
     */
    _createPanel(objectId) {
        const index = this._panels.size;
        const panel = new UIPanel({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: `Machine #${objectId}`,
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width: PANEL_WIDTH,
            height: PANEL_HEIGHT,
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
        const maxY = screen.height - PANEL_HEIGHT - SPAWN_MARGIN;
        panel.x = this._cascadeAxis((screen.width - PANEL_WIDTH) / 2, maxX, index);
        panel.y = this._cascadeAxis((screen.height - PANEL_HEIGHT) / 2, maxY, index);
        this.addChild(panel);
        return {panel};
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
        this._panels.forEach(record => {
            if (record.position === undefined) {
                return;
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
            const panelCenterScreen = {x: panel.x + PANEL_WIDTH / 2, y: panel.y + PANEL_HEIGHT / 2};
            const panelCenterWorld = this.viewport.toWorld(panelCenterScreen.x, panelCenterScreen.y);
            const machineEdge = rectEdgePoint(machineCenterWorld, panelCenterWorld, machineRect);
            const head = this.viewport.toScreen(machineEdge.x, machineEdge.y);

            // Panel attach point: rect edge toward the machine, in screen px.
            const panelRect = {
                minX: panel.x + CONNECTOR_PANEL_INSET,
                minY: panel.y + CONNECTOR_PANEL_INSET,
                maxX: panel.x + PANEL_WIDTH - CONNECTOR_PANEL_INSET,
                maxY: panel.y + PANEL_HEIGHT - CONNECTOR_PANEL_INSET,
            };
            const machineCenterScreen = this.viewport.toScreen(machineCenterWorld.x, machineCenterWorld.y);
            const tail = rectEdgePoint(panelCenterScreen, machineCenterScreen, panelRect);

            this._drawCurve(tail, head);
        });
    }

    /**
     * Draws a curve from `tail` to `head`, bowed perpendicular by sin(2·angle) of its length so it
     * eases through straight when axis-aligned and never snaps.
     * @param {{x: number, y: number}} tail
     * @param {{x: number, y: number}} head
     * @returns {void}
     * @private
     */
    _drawCurve(tail, head) {
        const dx = head.x - tail.x;
        const dy = head.y - tail.y;
        const mid = {x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2};
        // Bow proportional to sin(2·angle): straight when axis-aligned, most curved at 45°. Signed, so
        // it eases through zero (no snap) and bows the opposite way past each axis.
        const lengthSq = dx * dx + dy * dy;
        // Also fade to straight for short curves (smoothstep on length).
        const lengthFactor = smoothstep(CONNECTOR_BOW_MIN_LENGTH, CONNECTOR_BOW_FULL_LENGTH, Math.sqrt(lengthSq));
        const bow = lengthSq > 0 ? CONNECTOR_BOW * (2 * dx * dy / lengthSq) * lengthFactor : 0;
        const control = {x: mid.x - dy * bow, y: mid.y + dx * bow};

        this._connectors
            .moveTo(tail.x, tail.y)
            .quadraticCurveTo(control.x, control.y, head.x, head.y)
            .stroke({width: 1, color: CONNECTOR_COLOR, alpha: CONNECTOR_ALPHA});
    }
}
