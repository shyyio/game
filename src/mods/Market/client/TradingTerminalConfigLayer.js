import {Container, Text, Graphics} from "pixi.js";
import {UIPanel, buildPanelButton, BUTTON_HEIGHT, GAME_FONT, TILE_SIZE} from "@/sdk/client.js";
import {PANEL_TINT, PANEL_TITLE_TEXT, ACTIVE_ACCENT, TOOLBAR_TEXT} from "@/sdk/client.js";
import {rectEdgePoint, drawPanelConnector, CONNECTOR_PANEL_INSET} from "@/sdk/client.js";
import {ConfigureTradingTerminalMessage} from "../common/messages.js";
import {MARKET_SNAPSHOT_NONE} from "../common/events.js";
import {MARKET_MODE_SELL, MARKET_MODE_BUY} from "../common/constants.js";

const PANEL_WIDTH = 340;
const ROW_HEIGHT = BUTTON_HEIGHT;
const ROW_GAP = 6;
const HEADER_HEIGHT = 22;
const SECTION_GAP = 14;
const MAX_ITEM_ROWS = 6;
// Neutral tint for a toggle's inactive side.
const INACTIVE_TINT = 0x777777;

/**
 * Configures a placed Trading Terminal (mode, item, price) in the same framed-panel look as
 * FriendsPanelLayer: a draggable UIPanel with buildPanelButton rows. A screen-space HUD layer,
 * contributed via AbstractClientMod.hudLayers (mounted on app.stage, not the world viewport).
 */
export class TradingTerminalConfigLayer extends Container {

    /**
     * @param {Application} app
     * @param {ClientCache} cache
     * @param {AbstractSession} session
     */
    constructor(app, cache, session) {
        super();
        this._app = app;
        this._cache = cache;
        this._session = session;
        this._objects = cache.view("objects");
        this.textureRegistry = null;
        // Viewport for connector curve; set by host, same as InspectPanelLayer/FriendsPanelLayer.
        this.viewport = null;
        this.zIndex = 9600;
        this.visible = false;
        this._panel = null;
        this._panelHeight = 0;
        this._savedX = null;
        this._savedY = null;

        this._mode = MARKET_MODE_SELL;
        this._itemIndex = 0;
        this._price = 1;
        this._priceEdited = false;
        // The price row's live Text, mutated in place by the +/- stepper instead of a full rebuild.
        this._priceText = null;

        // Connector curve, drawn behind the panel and redrawn each frame.
        this._connector = new Graphics();
        this._connector.eventMode = "none";
        this.addChild(this._connector);
        this._app.ticker.add(() => this._drawConnector());

        cache.subscribe("market.configTarget", value => {
            if (value === null) {
                this._hide();
            } else {
                this._priceEdited = false;
                this._show();
            }
        });
        cache.subscribe("market.snapshot", () => {
            if (this.visible) {
                this._applySnapshot();
                this._rebuild();
            }
        });
    }

    /**
     * @private
     * @returns {number|null}
     */
    _targetObjectId() {
        return this._cache.get("market.configTarget");
    }

    /**
     * @private
     * @returns {MarketSnapshotEvent|null}
     */
    _snapshot() {
        return this._cache.get("market.snapshot");
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
        if (this._panel !== null) {
            this._savedX = this._panel.x;
            this._savedY = this._panel.y;
            this._panel.destroy({children: true});
            this._panel = null;
        }
        this._connector.clear();
    }

    /**
     * Seeds local UI state from a freshly arrived snapshot: the target's own current config if any,
     * else a sensible default (first tradable item, mode SELL).
     * @private
     * @returns {void}
     */
    _applySnapshot() {
        const snapshot = this._snapshot();
        if (snapshot === null) {
            return;
        }
        if (snapshot.currentItemType !== MARKET_SNAPSHOT_NONE) {
            this._mode = snapshot.currentMode;
            const index = snapshot.itemTypes.indexOf(snapshot.currentItemType);
            if (index === -1) {
                this._itemIndex = 0;
            } else {
                this._itemIndex = index;
            }
            this._price = snapshot.currentPrice;
            this._priceEdited = true;
        } else {
            this._itemIndex = 0;
            this._resetPriceDefault(snapshot);
        }
    }

    /**
     * Pre-fills the price from the best available same-side quote for the selected item; a no-op
     * once the player has touched the stepper.
     * @private
     * @param {MarketSnapshotEvent} [snapshot]
     * @returns {void}
     */
    _resetPriceDefault(snapshot = this._snapshot()) {
        if (this._priceEdited || snapshot === null || snapshot.itemTypes.length === 0) {
            return;
        }
        const npc = snapshot.npcPrices[this._itemIndex];
        if (npc !== MARKET_SNAPSHOT_NONE) {
            this._price = npc;
            return;
        }
        const sameSide = this._mode === MARKET_MODE_SELL
            ? snapshot.bestAskPrices[this._itemIndex]
            : snapshot.bestBidPrices[this._itemIndex];
        if (sameSide !== MARKET_SNAPSHOT_NONE) {
            this._price = sameSide;
            return;
        }
        const guide = snapshot.guidePrices[this._itemIndex];
        if (guide === MARKET_SNAPSHOT_NONE) {
            this._price = 1;
        } else {
            this._price = guide;
        }
    }

    /**
     * Builds the body into a detached container first (so its measured height sizes the panel),
     * then swaps it in, preserving the previous panel's position — mirrors FriendsPanelLayer.
     * @private
     * @returns {void}
     */
    _rebuild() {
        const objectId = this._targetObjectId();
        if (objectId === null) {
            return;
        }
        const snapshot = this._snapshot();
        const contentWidth = UIPanel.contentWidthFor(PANEL_WIDTH);
        const body = new Container();
        let y = 0;

        if (snapshot === null) {
            this._addText(body, "Loading...", 0, y);
            y += ROW_HEIGHT;
        } else {
            y = this._addHeader(body, "Mode", y);
            y = this._addModeRow(body, y);
            y += SECTION_GAP;

            y = this._addHeader(body, "Item", y);
            y = this._addItemRows(body, contentWidth, snapshot, y);
            y += SECTION_GAP;

            y = this._addHeader(body, "Price", y);
            y = this._addPriceRow(body, contentWidth, snapshot, y);
            y += SECTION_GAP;

            y = this._addConfirmRow(body, objectId, snapshot, y);
        }

        const previous = this._panel;
        let x;
        let py;
        if (this._savedX !== null) {
            x = this._savedX;
            py = this._savedY;
        } else {
            x = (this._app.screen.width - PANEL_WIDTH) / 2;
            py = (this._app.screen.height - UIPanel.heightForContent(y)) / 2;
        }
        if (previous !== null) {
            x = previous.x;
            py = previous.y;
            previous.destroy({children: true});
        }

        this._panelHeight = UIPanel.heightForContent(y);
        this._panel = new UIPanel({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: "Trading Terminal",
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width: PANEL_WIDTH,
            height: this._panelHeight,
            onClose: () => this._cache.writer("market").closeConfig(),
        });
        this._panel.x = x;
        this._panel.y = py;
        this.addChild(this._panel);
        this._panel.addContent(body);
    }

    /**
     * Redraws the curve from the panel to the terminal's tile. The attach points are ray-rect
     * boundary hits (continuous, so they never snap) — same construction as InspectPanelLayer's
     * connector. Runs every frame (world/panel move).
     * @private
     * @returns {void}
     */
    _drawConnector() {
        this._connector.clear();
        if (!this.visible || this._panel === null || this.viewport === null) {
            return;
        }
        const objectId = this._targetObjectId();
        const entry = objectId === null ? null : this._objects.get(objectId);
        if (entry === null) {
            return;
        }

        // Terminal attach point: rect edge toward the panel, in world px (inset scales with zoom).
        const tx = entry.tileX * TILE_SIZE;
        const ty = entry.tileY * TILE_SIZE;
        const terminalRect = {minX: tx, minY: ty, maxX: tx + TILE_SIZE, maxY: ty + TILE_SIZE};
        const terminalCenterWorld = {x: tx + TILE_SIZE / 2, y: ty + TILE_SIZE / 2};
        const panelCenterScreen = {x: this._panel.x + PANEL_WIDTH / 2, y: this._panel.y + this._panelHeight / 2};
        const panelCenterWorld = this.viewport.toWorld(panelCenterScreen.x, panelCenterScreen.y);
        const terminalEdge = rectEdgePoint(terminalCenterWorld, panelCenterWorld, terminalRect);
        const head = this.viewport.toScreen(terminalEdge.x, terminalEdge.y);

        // Panel attach point: rect edge toward the terminal, in screen px.
        const panelRect = {
            minX: this._panel.x + CONNECTOR_PANEL_INSET,
            minY: this._panel.y + CONNECTOR_PANEL_INSET,
            maxX: this._panel.x + PANEL_WIDTH - CONNECTOR_PANEL_INSET,
            maxY: this._panel.y + this._panelHeight - CONNECTOR_PANEL_INSET,
        };
        const terminalCenterScreen = this.viewport.toScreen(terminalCenterWorld.x, terminalCenterWorld.y);
        const tail = rectEdgePoint(panelCenterScreen, terminalCenterScreen, panelRect);

        drawPanelConnector(this._connector, tail, head);
    }

    /**
     * @private
     * @param {Container} body
     * @param {string} label
     * @param {number} y
     * @returns {number} the next y
     */
    _addHeader(body, label, y) {
        const text = new Text({
            text: label,
            style: {fontFamily: GAME_FONT, fontSize: 14, fill: TOOLBAR_TEXT, fontWeight: "bold"},
        });
        text.y = y;
        body.addChild(text);
        return y + HEADER_HEIGHT;
    }

    /**
     * @private
     * @param {Container} body
     * @param {string} label
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    _addText(body, label, x, y) {
        const text = new Text({text: label, style: {fontFamily: GAME_FONT, fontSize: 15, fill: TOOLBAR_TEXT}});
        text.x = x;
        text.y = y;
        body.addChild(text);
    }

    /**
     * Applies a mode/item selection, resets the price to its default for the new selection, and
     * rebuilds the panel.
     * @private
     * @param {function(): void} assign
     * @returns {void}
     */
    _selectAndReset(assign) {
        assign();
        this._priceEdited = false;
        this._resetPriceDefault();
        this._rebuild();
    }

    /**
     * @private
     * @param {Container} body
     * @param {number} y
     * @returns {number} the next y
     */
    _addModeRow(body, y) {
        const row = new Container();
        row.y = y;
        const sellTint = this._mode === MARKET_MODE_SELL ? ACTIVE_ACCENT : INACTIVE_TINT;
        const sell = buildPanelButton(this.textureRegistry, "Sell", sellTint, () => {
            this._selectAndReset(() => {
                this._mode = MARKET_MODE_SELL;
            });
        });
        row.addChild(sell);
        const buyTint = this._mode === MARKET_MODE_BUY ? ACTIVE_ACCENT : INACTIVE_TINT;
        const buy = buildPanelButton(this.textureRegistry, "Buy", buyTint, () => {
            this._selectAndReset(() => {
                this._mode = MARKET_MODE_BUY;
            });
        });
        buy.x = sell.width + ROW_GAP;
        row.addChild(buy);
        body.addChild(row);
        return y + ROW_HEIGHT + ROW_GAP;
    }

    /**
     * @private
     * @param {Container} body
     * @param {number} contentWidth
     * @param {MarketSnapshotEvent} snapshot
     * @param {number} y
     * @returns {number} the next y
     */
    _addItemRows(body, contentWidth, snapshot, y) {
        if (snapshot.itemTypes.length === 0) {
            this._addText(body, "No tradable items configured.", 0, y);
            return y + ROW_HEIGHT + ROW_GAP;
        }
        let cursorY = y;
        for (let i = 0; i < Math.min(snapshot.itemTypes.length, MAX_ITEM_ROWS); i += 1) {
            const itemType = snapshot.itemTypes[i];
            const npc = snapshot.npcPrices[i];
            let detail;
            if (npc !== MARKET_SNAPSHOT_NONE) {
                detail = `fixed: ${npc}`;
            } else {
                const bid = snapshot.bestBidPrices[i] === MARKET_SNAPSHOT_NONE ? "-" : snapshot.bestBidPrices[i];
                const ask = snapshot.bestAskPrices[i] === MARKET_SNAPSHOT_NONE ? "-" : snapshot.bestAskPrices[i];
                detail = `bid ${bid} / ask ${ask}`;
            }
            const row = new Container();
            row.y = cursorY;
            this._addText(row, `Item ${itemType} (${detail})`, 0, (ROW_HEIGHT - 15) / 2);
            const selected = i === this._itemIndex;
            const selectLabel = selected ? "Selected" : "Select";
            const selectTint = selected ? ACTIVE_ACCENT : INACTIVE_TINT;
            const select = buildPanelButton(this.textureRegistry, selectLabel, selectTint, () => {
                this._selectAndReset(() => {
                    this._itemIndex = i;
                });
            });
            select.x = contentWidth - select.width;
            row.addChild(select);
            body.addChild(row);
            cursorY += ROW_HEIGHT + ROW_GAP;
        }
        return cursorY;
    }

    /**
     * @private
     * @param {Container} body
     * @param {number} contentWidth
     * @param {MarketSnapshotEvent} snapshot
     * @param {number} y
     * @returns {number} the next y
     */
    _addPriceRow(body, contentWidth, snapshot, y) {
        const row = new Container();
        row.y = y;
        const npcSelected = snapshot.itemTypes.length > 0 && snapshot.npcPrices[this._itemIndex] !== MARKET_SNAPSHOT_NONE;
        this._priceText = new Text({
            text: this._priceLabel(npcSelected),
            style: {fontFamily: GAME_FONT, fontSize: 15, fill: TOOLBAR_TEXT},
        });
        this._priceText.y = (ROW_HEIGHT - 15) / 2;
        row.addChild(this._priceText);
        if (!npcSelected) {
            const plus = buildPanelButton(this.textureRegistry, "+", ACTIVE_ACCENT, () => this._stepPrice(1));
            plus.x = contentWidth - plus.width;
            row.addChild(plus);
            const minus = buildPanelButton(this.textureRegistry, "-", ACTIVE_ACCENT, () => this._stepPrice(-1));
            minus.x = plus.x - minus.width - ROW_GAP;
            row.addChild(minus);
        }
        body.addChild(row);
        return y + ROW_HEIGHT + ROW_GAP;
    }

    /**
     * @private
     * @param {boolean} npcSelected
     * @returns {string}
     */
    _priceLabel(npcSelected) {
        if (npcSelected) {
            return `Price: ${this._price} (fixed)`;
        }
        return `Price: ${this._price}`;
    }

    /**
     * Adjusts the price by `delta` and updates the price row's Text in place — the stepper never
     * touches mode/item/confirm state, so a full panel rebuild is unneeded work.
     * @private
     * @param {number} delta
     * @returns {void}
     */
    _stepPrice(delta) {
        this._price = Math.max(1, this._price + delta);
        this._priceEdited = true;
        this._priceText.text = this._priceLabel(false);
    }

    /**
     * @private
     * @param {Container} body
     * @param {number} objectId
     * @param {MarketSnapshotEvent} snapshot
     * @param {number} y
     * @returns {number} the next y
     */
    _addConfirmRow(body, objectId, snapshot, y) {
        const row = new Container();
        row.y = y;
        const canConfirm = snapshot.itemTypes.length > 0;
        const confirm = buildPanelButton(this.textureRegistry, "Confirm", ACTIVE_ACCENT, () => {
            const itemType = snapshot.itemTypes[this._itemIndex];
            this._session.sendMessage(new ConfigureTradingTerminalMessage(objectId, this._mode, itemType, this._price));
            this._cache.writer("market").closeConfig();
        }, !canConfirm);
        row.addChild(confirm);
        body.addChild(row);
        return y + ROW_HEIGHT;
    }
}
