import {ManagedPanel, UIPanel, ConnectedPanelLayer, TextRole, TILE_SIZE} from "@spup/sdk/client";
import {PANEL_TINT, PANEL_TITLE_TEXT} from "@spup/sdk/client";

const PANEL_WIDTH = 340;
const MAX_DEVICE_ROWS = 6;

/**
 * Shows a placed Control Terminal's network: wired state, tier, and the connected devices;
 * framed-panel HUD layer like TradingTerminalConfigLayer.
 */
export class ControlTerminalConfigLayer extends ConnectedPanelLayer {

    /**
     * @param {Application} app
     * @param {ClientCache} cache
     * @param {ModRegistry} modRegistry
     */
    constructor(
        app,
        cache,
        modRegistry,
    ) {
        super(app);
        this._cache = cache;
        this._modRegistry = modRegistry;
        this._objects = cache.view("objects");
        this.textureRegistry = null;
        this.zIndex = 9600;
        this.visible = false;
        this._managed = new ManagedPanel();

        this._connectors.set("terminal", () => this._managed.panel, () => {
            const objectId = this._targetObjectId();
            const entry = objectId === null ? null : this._objects.get(objectId);
            if (entry === null) {
                return null;
            }
            return {x: entry.tileX, y: entry.tileY};
        });

        cache.subscribe("logistics.configTarget", value => {
            if (value === null) {
                this._hide();
            } else {
                this._show();
            }
        });
        cache.subscribe("logistics.controlSnapshot", () => {
            if (this.visible) {
                this._rebuild();
            }
        });
    }

    /**
     * @private
     * @returns {number|null}
     */
    _targetObjectId() {
        return this._cache.get("logistics.configTarget");
    }

    /**
     * Repaints for the current theme; the engine calls this on any HUD layer defining it.
     * @returns {void}
     */
    restyle() {
        if (this.visible) {
            this._rebuild();
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _show() {
        this.visible = true;
        this._rebuild();
    }

    /**
     * @private
     * @returns {void}
     */
    _hide() {
        this.visible = false;
        this._managed.hide();
    }

    /**
     * @private
     * @returns {void}
     */
    _rebuild() {
        const objectId = this._targetObjectId();
        if (objectId === null) {
            return;
        }
        const snapshot = this._cache.get("logistics.controlSnapshot");

        const panel = this._managed.show({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: "Control Terminal",
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width: PANEL_WIDTH,
            onClose: () => this._cache.writer("logistics").closeTerminalConfig(),
        }, UIPanel.centerPosition(this._app, PANEL_WIDTH), (stack) => this._buildBody(stack, snapshot));
        this.addChild(panel);
    }

    /**
     * @private
     * @param {PanelStack} stack
     * @param {ControlSnapshotEvent|null} snapshot
     * @returns {void}
     */
    _buildBody(stack, snapshot) {
        if (snapshot === null) {
            stack.text("Loading...");
            return;
        }
        if (snapshot.linked === 0) {
            stack.text("Not wired to a control network.", TextRole.MUTED);
            return;
        }
        stack.text(`Tier ${snapshot.tier}`, TextRole.MUTED);
        stack.gap();
        stack.header(`Devices (${snapshot.deviceObjectIds.length})`);
        stack.scrollSection(this.viewport, snapshot.deviceObjectIds, (deviceObjectId, i) => {
            const type = this._modRegistry.typeById(snapshot.deviceTypeIds[i]);
            const tileX = snapshot.deviceTileXs[i];
            const tileY = snapshot.deviceTileYs[i];
            return {
                label: type.label,
                trailingLabel: `${tileX}, ${tileY}`,
                onRowClick: () => this._glideToDevice(tileX, tileY),
            };
        }, "No devices wired to this network.", {visibleRows: MAX_DEVICE_ROWS});
    }

    /**
     * Glides the game viewport to a device's tile, keeping the panel open.
     * @private
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    _glideToDevice(tileX, tileY) {
        this.viewport.glideTo({
            x: tileX * TILE_SIZE + TILE_SIZE / 2,
            y: tileY * TILE_SIZE + TILE_SIZE / 2,
        });
    }
}
