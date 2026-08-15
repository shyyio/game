import {Container} from "pixi.js";
import {format} from "d3-format";
import {UIPanel} from "@/client/hud/UIPanel.js";
import {PanelStack, PanelRowDescriptor} from "@/client/hud/PanelStack.js";
import {PANEL_TINT, PANEL_TITLE_TEXT} from "@/client/Theme.js";
import {MetricsLineChart} from "@/client/hud/MetricsLineChart.js";
import {CHART_METRIC_COUNT, seriesRates} from "@/client/hud/MetricsChartData.js";
import {metricsRollupKey} from "@/common/MetricsFact.js";
import {GameSettingsKey} from "@/common/constants.js";

const PANEL_WIDTH = 640;
const CHART_HEIGHT = 280;
// Vertical space between the chart inset and the item list below it.
const LIST_GAP = 12;

const formatRate = format(",.1f");
// Keep the panel this far clear of both screen edges on narrow (mobile) viewports.
const SCREEN_MARGIN = 16;
// Default open position: right edge under the button row, clear of it by this much.
const ANCHOR_MARGIN_RIGHT = 16;
const ANCHOR_GAP = 12;
// Above the always-visible settings/friends/production buttons (9500), below toasts/dialogs.
const Z_INDEX = 9600;
// Matches TextInput/SelectableText's DOM-overlay convention.
const DOM_Z_INDEX = "1000";

/**
 * Production-rate panel: a draggable {@link UIPanel} with a sunken inset placeholder that a real
 * DOM/SVG {@link MetricsLineChart} overlays every tick, plus a scrollable per-item rate list
 * whose rows toggle a series highlight on the chart.
 */
export class ProductionPanelLayer extends Container {

    /**
     * @param {Application} app
     * @param {ClientCache} state
     * @param {number} metricsType - METRICS_FACT_TYPE_* the chart plots
     * @param {number} scope - METRICS_QUERY_SCOPE_*, echoed back through the (un)subscribe callbacks
     * @param {ItemRegistry} items - names the list's rows (a series' category is an item type)
     */
    constructor(
        app,
        state,
        metricsType,
        scope,
        items,
    ) {
        super();
        this._app = app;
        this._state = state;
        this._metricsType = metricsType;
        this._scope = scope;
        this._items = items;
        this._rollupKey = metricsRollupKey(metricsType, scope);
        this._metrics = state.view("metrics");
        this._gameSettings = state.view("gameSettings");
        this._clock = state.view("clock");
        this.textureRegistry = null;
        // The production button, to open below it by default (set by the host).
        this.anchorButton = null;
        // The game viewport, frozen against wheel-zoom while the list scrollbar is hovered (set by the host).
        this.viewport = null;
        this.zIndex = Z_INDEX;
        this.visible = false;

        this._panel = null;
        this._chartInset = null;
        this._chartRoot = null;
        this._chart = null;
        this._tick = null;
        this._unbindRollup = null;
        this._unbindTickMs = null;
        this._unbindClock = null;
        this._savedX = null;
        this._savedY = null;
        this._onSubscribe = null;
        this._onUnsubscribe = null;
        this._rollup = undefined;
        this._listHandle = null;
        // Selected series key ("category:tag"), kept across close/reopen.
        this._selectedKey = null;
    }

    /**
     * @param {function(metricsType: number, scope: number, tier: number, windowTicks: number): void} callback
     */
    onSubscribe(callback) {
        this._onSubscribe = callback;
    }

    /**
     * @param {function(metricsType: number, scope: number): void} callback
     */
    onUnsubscribe(callback) {
        this._onUnsubscribe = callback;
    }

    /**
     * @returns {void}
     */
    toggle() {
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * @returns {void}
     */
    show() {
        if (this.visible) {
            return;
        }
        this.visible = true;
        this._build();
    }

    /**
     * Repaints for the current theme.
     * @returns {void}
     */
    restyle() {
        if (this.visible) {
            this._teardown();
            this._build();
        }
    }

    /**
     * @returns {void}
     */
    hide() {
        if (!this.visible) {
            return;
        }
        this.visible = false;
        this._teardown();
    }

    /**
     * @private
     * @returns {number}
     */
    _panelWidth() {
        return Math.min(PANEL_WIDTH, this._app.screen.width - SCREEN_MARGIN * 2);
    }

    /**
     * Below the production button by default, or centered on first-ever show.
     * @private
     * @param {number} width
     * @param {number} height
     * @returns {{x: number, y: number}}
     */
    _defaultPosition(width, height) {
        if (this._savedX !== null) {
            return {x: this._savedX, y: this._savedY};
        }
        if (this.anchorButton !== null) {
            return {
                x: this._app.screen.width - ANCHOR_MARGIN_RIGHT - width,
                y: this.anchorButton.bottomY + ANCHOR_GAP,
            };
        }
        return UIPanel.centerPosition(this._app, width)(height);
    }

    /**
     * @private
     * @returns {void}
     */
    _build() {
        const width = this._panelWidth();
        const contentWidth = UIPanel.contentWidthFor(width);

        // Fixed-height list section, so pushes can swap the row set without resizing the panel.
        const stack = new PanelStack(this.textureRegistry, contentWidth);
        this._listHandle = stack.scrollSection(this.viewport, [], entry => this._describeEntry(entry),
            "No production yet", {fixedHeight: true});
        stack.y = CHART_HEIGHT + LIST_GAP;

        const height = UIPanel.heightForContent(CHART_HEIGHT + LIST_GAP + stack.contentHeight);
        const panel = new UIPanel({
            app: this._app,
            textureRegistry: this.textureRegistry,
            title: "Production",
            titleColor: PANEL_TITLE_TEXT,
            tint: PANEL_TINT,
            width,
            height,
            onClose: () => this.hide(),
        });
        const {x, y} = this._defaultPosition(width, height);
        panel.x = x;
        panel.y = y;
        this._panel = panel;

        // Placeholder the real DOM/SVG chart overlay sits on top of every frame (see _positionChartRoot()).
        this._chartInset = UIPanel.insetSprite(this.textureRegistry, panel.contentWidth, CHART_HEIGHT, PANEL_TINT);
        panel.addContent(this._chartInset);
        panel.addContent(stack);
        this.addChild(panel);

        this._chartRoot = document.createElement("div");
        Object.assign(this._chartRoot.style, {
            position: "fixed", zIndex: DOM_Z_INDEX, left: "0px", top: "0px", width: "1px", height: "1px",
            overflow: "hidden", pointerEvents: "auto",
        });
        document.body.appendChild(this._chartRoot);

        this._chart = new MetricsLineChart(this._chartRoot, {
            metric: CHART_METRIC_COUNT,
            width: panel.contentWidth,
            height: CHART_HEIGHT,
            onWindowChange: (tier, windowTicks) => {
                if (this._onSubscribe !== null) {
                    this._onSubscribe(this._metricsType, this._scope, tier, windowTicks);
                }
            },
            onRangeChange: () => this._refreshList(),
        });
        this._chart.setHighlightKey(this._selectedKey);
        this._rollup = this._metrics.rollup(this._metricsType, this._scope);
        this._chart.push(this._rollup);
        this._refreshList();
        this._unbindRollup = this._state.subscribe("metrics.rollups", (key, value) => {
            if (key === this._rollupKey) {
                this._rollup = value;
                this._chart.push(value);
                this._refreshList();
            }
        });

        this._chart.setTickIntervalMs(this._gameSettings.get(GameSettingsKey.TICK_MS));
        this._unbindTickMs = this._state.subscribe("gameSettings.values", (key, value) => {
            if (key === GameSettingsKey.TICK_MS) {
                this._chart.setTickIntervalMs(value);
            }
        });

        this._chart.setClockTick(this._clock.tick());
        this._unbindClock = this._state.subscribe("clock.tick", (tick) => this._chart.setClockTick(tick));

        this._tick = () => this._positionChartRoot();
        this._app.ticker.add(this._tick);
        this._positionChartRoot();
    }

    /**
     * Recomputes the rate rows from the current rollup and the chart's visible range; drops a
     * selection whose series vanished from the data.
     * @private
     * @returns {void}
     */
    _refreshList() {
        const entries = this._listEntries();
        if (this._selectedKey !== null && !entries.some(entry => entry.key === this._selectedKey)) {
            this._selectedKey = null;
            this._chart.setHighlightKey(null);
        }
        this._listHandle.update(entries);
    }

    /**
     * @private
     * @returns {SeriesRate[]}
     */
    _listEntries() {
        if (this._rollup === undefined) {
            return [];
        }
        // Same shifted "now" the chart plots against: the freshest completed point.
        const nowTick = this._rollup.toTick - 2 * this._rollup.tier;
        return seriesRates(this._rollup, this._chart.rangeTicks, nowTick);
    }

    /**
     * @private
     * @param {SeriesRate} entry
     * @returns {PanelRowDescriptor}
     */
    _describeEntry(entry) {
        return new PanelRowDescriptor({
            label: this._itemName(entry.category),
            swatchColor: this._chart.colorFor(entry.key),
            trailingLabel: this._rateLabel(entry.ratePerTick),
            selected: entry.key === this._selectedKey,
            onRowClick: () => this._toggleSelect(entry.key),
        });
    }

    /**
     * @private
     * @param {number} itemType
     * @returns {string}
     */
    _itemName(itemType) {
        const definition = this._items.get(itemType);
        if (definition === undefined) {
            return `Item ${itemType}`;
        }
        return definition.name;
    }

    /**
     * The per-minute production rate, e.g. "13.4/m"; a dash until TICK_MS is synced.
     * @private
     * @param {number} ratePerTick
     * @returns {string}
     */
    _rateLabel(ratePerTick) {
        const tickMs = this._gameSettings.get(GameSettingsKey.TICK_MS);
        if (tickMs === undefined) {
            return "-/m";
        }
        const perMinute = ratePerTick * (60000 / tickMs);
        return `${formatRate(perMinute)}/m`;
    }

    /**
     * Selects a series (highlighting its chart line, dimming the rest) or deselects it again.
     * @private
     * @param {string} key
     * @returns {void}
     */
    _toggleSelect(key) {
        if (this._selectedKey === key) {
            this._selectedKey = null;
        } else {
            this._selectedKey = key;
        }
        this._chart.setHighlightKey(this._selectedKey);
        this._refreshList();
    }

    /**
     * The chart root div lives outside the pixi display tree, so a whole-app destroy needs this override to reach it.
     * @param {object} [options]
     * @returns {void}
     */
    destroy(options) {
        if (this.visible) {
            this.visible = false;
            this._teardown();
        }
        super.destroy(options);
    }

    /**
     * @private
     * @returns {void}
     */
    _teardown() {
        this._savedX = this._panel.x;
        this._savedY = this._panel.y;
        if (this._onUnsubscribe !== null) {
            this._onUnsubscribe(this._metricsType, this._scope);
        }
        this._app.ticker.remove(this._tick);
        this._tick = null;
        this._unbindRollup();
        this._unbindRollup = null;
        this._unbindTickMs();
        this._unbindTickMs = null;
        this._unbindClock();
        this._unbindClock = null;
        this._chart.destroy();
        this._chart = null;
        this._chartRoot.remove();
        this._chartRoot = null;
        this._chartInset = null;
        this._listHandle = null;
        this._panel.destroy({children: true});
        this._panel = null;
    }

    /**
     * Glues _chartRoot to the placeholder inset's current on-screen rect, so dragging the panel drags the chart with it.
     * @private
     * @returns {void}
     */
    _positionChartRoot() {
        const bounds = this._chartInset.getBounds();
        const canvasRect = this._app.canvas.getBoundingClientRect();
        this._chartRoot.style.left = `${canvasRect.left + bounds.x}px`;
        this._chartRoot.style.top = `${canvasRect.top + bounds.y}px`;
        this._chartRoot.style.width = `${Math.max(bounds.width, 1)}px`;
        this._chartRoot.style.height = `${Math.max(bounds.height, 1)}px`;
    }
}
