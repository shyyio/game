import {Container} from "pixi.js";
import {UIPanel} from "@/client/UIPanel.js";
import {PANEL_TINT, PANEL_TITLE_TEXT} from "@/client/Theme.js";
import {MetricsLineChart} from "@/client/MetricsLineChart.js";
import {METRICS_EVENT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN, metricsRollupKey} from "@/common/MetricsEvent.js";
import {GameSettingsKey} from "@/common/constants.js";

const PANEL_WIDTH = 640;
const CHART_HEIGHT = 280;
// Keep the panel this far clear of both screen edges on narrow (mobile) viewports.
const SCREEN_MARGIN = 16;
// Default open position: right edge under the button row, clear of it by this much.
const ANCHOR_MARGIN_RIGHT = 16;
const ANCHOR_GAP = 12;
// Above the always-visible settings/friends/production buttons (9500), below toasts/dialogs.
const Z_INDEX = 9600;
// Matches TextInput/SelectableText's DOM-overlay convention.
const DOM_Z_INDEX = "1000";

const ROLLUP_KEY = metricsRollupKey(METRICS_EVENT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN);

/**
 * Production-rate panel: a draggable {@link UIPanel} with a sunken inset placeholder that a real DOM/SVG {@link MetricsLineChart} overlays every tick.
 */
export class ProductionPanelLayer extends Container {

    /**
     * @param {Application} app
     * @param {ClientCache} state
     */
    constructor(app, state) {
        super();
        this._app = app;
        this._state = state;
        this._metrics = state.view("metrics");
        this._gameSettings = state.view("gameSettings");
        this.textureRegistry = null;
        // The production button, to open below it by default (set by the host).
        this.anchorButton = null;
        this.zIndex = Z_INDEX;
        this.visible = false;

        this._panel = null;
        this._chartInset = null;
        this._chartRoot = null;
        this._chart = null;
        this._tick = null;
        this._unbindRollup = null;
        this._unbindTickMs = null;
        this._savedX = null;
        this._savedY = null;
        this._onSubscribe = null;
        this._onUnsubscribe = null;
    }

    /**
     * @param {function(bucketTicks: number, windowTicks: number): void} callback
     */
    onSubscribe(callback) {
        this._onSubscribe = callback;
    }

    /**
     * @param {function(): void} callback
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
        const height = UIPanel.heightForContent(CHART_HEIGHT);
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
        this.addChild(panel);

        this._chartRoot = document.createElement("div");
        Object.assign(this._chartRoot.style, {
            position: "fixed", zIndex: DOM_Z_INDEX, left: "0px", top: "0px", width: "1px", height: "1px",
            overflow: "hidden", pointerEvents: "auto",
        });
        document.body.appendChild(this._chartRoot);

        this._chart = new MetricsLineChart(this._chartRoot, {
            metric: "count",
            width: panel.contentWidth,
            height: CHART_HEIGHT,
            onSubscribe: (bucketTicks, windowTicks) => {
                if (this._onSubscribe !== null) {
                    this._onSubscribe(bucketTicks, windowTicks);
                }
            },
        });
        this._chart.push(this._metrics.rollup(METRICS_EVENT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN));
        this._unbindRollup = this._state.subscribe("metrics.rollups", (key, value) => {
            if (key === ROLLUP_KEY) {
                this._chart.push(value);
            }
        });

        this._chart.setTickIntervalMs(this._gameSettings.get(GameSettingsKey.TICK_MS));
        this._unbindTickMs = this._state.subscribe("gameSettings.values", (key, value) => {
            if (key === GameSettingsKey.TICK_MS) {
                this._chart.setTickIntervalMs(value);
            }
        });

        this._tick = () => this._positionChartRoot();
        this._app.ticker.add(this._tick);
        this._positionChartRoot();
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
            this._onUnsubscribe();
        }
        this._app.ticker.remove(this._tick);
        this._tick = null;
        this._unbindRollup();
        this._unbindRollup = null;
        this._unbindTickMs();
        this._unbindTickMs = null;
        this._chart.destroy();
        this._chart = null;
        this._chartRoot.remove();
        this._chartRoot = null;
        this._chartInset = null;
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
