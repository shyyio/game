import {ManagedPanel, UIPanel, buildPanelButton, buildToggleRow, ConnectedPanelLayer, ROW_HEIGHT, ROW_GAP, panelText, TextRole} from "@/sdk/client.js";
import {PANEL_TINT, PANEL_TITLE_TEXT, ACTIVE_ACCENT} from "@/sdk/client.js";
import {ConfigureTradingTerminalMessage} from "../common/messages.js";
import {MARKET_SNAPSHOT_NONE} from "../common/events.js";
import {MARKET_MODE_SELL, MARKET_MODE_BUY} from "../common/constants.js";

const PANEL_WIDTH = 340;
const MAX_ITEM_ROWS = 6;
// Neutral tint for a toggle's inactive side.
const INACTIVE_TINT = 0x777777;

/**
 * Configures a placed Trading Terminal (mode, item, price); framed-panel HUD layer like FriendsPanelLayer.
 */
export class TradingTerminalConfigLayer extends ConnectedPanelLayer {

    /**
     * @param {Application} app
     * @param {ClientCache} cache
     * @param {AbstractSession} session
     * @param {ItemRegistry} items
     */
    constructor(
        app,
        cache,
        session,
        items,
    ) {
        super(app);
        this._cache = cache;
        this._session = session;
        this._items = items;
        this._objects = cache.view("objects");
        this.textureRegistry = null;
        this.zIndex = 9600;
        this.visible = false;
        this._managed = new ManagedPanel();

        this._mode = MARKET_MODE_SELL;
        this._itemIndex = 0;
        this._price = 1;
        this._priceEdited = false;
        // The price row's live Text, mutated in place by the +/- stepper instead of a full rebuild.
        this._priceText = null;

        this._connectors.set("terminal", () => this._managed.panel, () => {
            const objectId = this._targetObjectId();
            const entry = objectId === null ? null : this._objects.get(objectId);
            if (entry === null) {
                return null;
            }
            return {x: entry.tileX, y: entry.tileY};
        });

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
        this._managed.hide();
    }

    /**
     * Seeds local UI state from a fresh snapshot: target's current config, else a default (first item, SELL).
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
     * @private
     * @returns {void}
     */
    _rebuild() {
        const objectId = this._targetObjectId();
        if (objectId === null) {
            return;
        }
        const snapshot = this._snapshot();

        const panel = this._managed.show({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: "Trading Terminal",
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width: PANEL_WIDTH,
            onClose: () => this._cache.writer("market").closeConfig(),
        }, UIPanel.centerPosition(this._app, PANEL_WIDTH), (stack) => this._buildBody(stack, objectId, snapshot));
        this.addChild(panel);
    }

    /**
     * @private
     * @param {PanelStack} stack
     * @param {number} objectId
     * @param {MarketSnapshotEvent|null} snapshot
     * @returns {void}
     */
    _buildBody(stack, objectId, snapshot) {
        if (snapshot === null) {
            stack.text("Loading...");
            return;
        }

        stack.header("Mode");
        stack.row((row) => this._fillModeRow(row));
        stack.gap();

        stack.header("Item");
        stack.scrollSection(this.viewport, snapshot.itemTypes, (itemType, i) => ({
            label: `${this._items.require(itemType).name} (${this._itemDetail(snapshot, i)})`,
            buttonLabel: i === this._itemIndex ? "Selected" : "Select",
            buttonTint: i === this._itemIndex ? ACTIVE_ACCENT : INACTIVE_TINT,
            onClick: () => this._selectAndReset(() => this._itemIndex = i),
        }), "No tradable items configured.", {visibleRows: MAX_ITEM_ROWS});
        stack.gap();

        stack.header("Price");
        stack.row((row) => this._fillPriceRow(row, stack.contentWidth, snapshot));
        stack.gap();

        stack.row((row) => this._fillConfirmRow(row, objectId, snapshot));
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
     * @param {Container} row
     * @returns {void}
     */
    _fillModeRow(row) {
        const options = [
            {value: MARKET_MODE_SELL, label: "Sell"},
            {value: MARKET_MODE_BUY, label: "Buy"},
        ];
        const toggle = buildToggleRow(this.textureRegistry, options, this._mode, mode => {
            this._selectAndReset(() => {
                this._mode = mode;
            });
        }, {activeTint: ACTIVE_ACCENT, inactiveTint: INACTIVE_TINT, gap: ROW_GAP});
        row.addChild(toggle);
    }

    /**
     * @private
     * @param {MarketSnapshotEvent} snapshot
     * @param {number} i
     * @returns {string}
     */
    _itemDetail(snapshot, i) {
        const npc = snapshot.npcPrices[i];
        if (npc !== MARKET_SNAPSHOT_NONE) {
            return `fixed: ${npc}`;
        }
        const bid = this._priceOrDash(snapshot.bestBidPrices[i]);
        const ask = this._priceOrDash(snapshot.bestAskPrices[i]);
        return `bid ${bid} / ask ${ask}`;
    }

    /**
     * @private
     * @param {number} price
     * @returns {string|number}
     */
    _priceOrDash(price) {
        if (price === MARKET_SNAPSHOT_NONE) {
            return "-";
        }
        return price;
    }

    /**
     * @private
     * @param {Container} row
     * @param {number} contentWidth
     * @param {MarketSnapshotEvent} snapshot
     * @returns {void}
     */
    _fillPriceRow(row, contentWidth, snapshot) {
        const npcSelected = snapshot.itemTypes.length > 0 && snapshot.npcPrices[this._itemIndex] !== MARKET_SNAPSHOT_NONE;
        this._priceText = panelText(this._priceLabel(npcSelected), TextRole.BODY);
        this._priceText.y = (ROW_HEIGHT - this._priceText.height) / 2;
        row.addChild(this._priceText);
        if (!npcSelected) {
            const plus = buildPanelButton(this.textureRegistry, "+", ACTIVE_ACCENT, () => this._stepPrice(1));
            plus.x = contentWidth - plus.width;
            row.addChild(plus);
            const minus = buildPanelButton(this.textureRegistry, "-", ACTIVE_ACCENT, () => this._stepPrice(-1));
            minus.x = plus.x - minus.width - ROW_GAP;
            row.addChild(minus);
        }
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
     * Adjusts the price by `delta` and updates the price row's Text in place, skipping a full rebuild.
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
     * @param {Container} row
     * @param {number} objectId
     * @param {MarketSnapshotEvent} snapshot
     * @returns {void}
     */
    _fillConfirmRow(row, objectId, snapshot) {
        const canConfirm = snapshot.itemTypes.length > 0;
        const confirm = buildPanelButton(this.textureRegistry, "Confirm", ACTIVE_ACCENT, () => {
            const itemType = snapshot.itemTypes[this._itemIndex];
            this._session.sendMessage(new ConfigureTradingTerminalMessage(objectId, this._mode, itemType, this._price));
            this._cache.writer("market").closeConfig();
        }, !canConfirm);
        row.addChild(confirm);
    }
}
