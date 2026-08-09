import {select} from "d3-selection";
import {line} from "d3-shape";
import {scaleLinear} from "d3-scale";
import {axisBottom, axisLeft} from "d3-axis";
import {format} from "d3-format";
import {ChartColors, INK_MUTED} from "@/client/ChartColors.js";
import {selectBucketTicks, windowTicksFor, buildSeries, integerTicks, visibleExtent} from "@/client/MetricsChartData.js";
import {TickIntervalEstimator} from "@/client/TickIntervalEstimator.js";

const INK = "#000000";
const GRID = "#e1e0d9";

const MARGIN = {top: 12, right: 16, bottom: 32, left: 28};

const DEFAULT_RANGE_TICKS = 100;
// Full-width drag: left = zoom to 1/N, right = zoom to N×.
const ZOOM_DRAG_STRENGTH = 4;
const WHEEL_ZOOM_IN_FACTOR = 0.85;
const WHEEL_ZOOM_OUT_FACTOR = 1.15;
const MIN_RANGE_TICKS = 60;
const MAX_RANGE_TICKS = 1_000_000;

const formatCount = format(",d");
const formatAvg = format(",.2~f");

let nextInstanceId = 0;

/**
 * Scrolling, drag/wheel-zoomable line chart over a MetricsRollupRow accumulation: real d3/SVG
 * mounted into a caller-owned DOM element, no framework binding of its own.
 */
export class MetricsLineChart {

    /**
     * @param {HTMLElement} container - mounts an <svg> and an empty-state <div>; never resized/positioned by this class
     * @param {object} [options]
     * @param {string} [options.metric] "count" | "sum" | "avg"
     * @param {number} [options.width]
     * @param {number} [options.height]
     * @param {function(bucketTicks: number, windowTicks: number): void} [options.onSubscribe] fired on
     *     construction and again whenever a zoom gesture needs more data
     */
    constructor(container, {metric = "count", width = null, height = null, onSubscribe = null} = {}) {
        this._container = container;
        this._metric = metric;
        this._onSubscribe = onSubscribe;

        this._instanceId = nextInstanceId;
        nextInstanceId += 1;
        this._svg = null;
        this._gGridY = null;
        this._gAxisX = null;
        this._gAxisY = null;
        this._gLines = null;
        this._clipRect = null;
        this._overlay = null;
        this._emptyEl = null;

        this._xScale = scaleLinear();
        this._yScale = scaleLinear();
        this._targetWidth = null;
        this._targetHeight = null;
        this._plotWidth = 0;
        this._plotHeight = 0;

        this._rollup = undefined;
        this._latestSeriesData = null;
        this._hasData = false;
        this._rangeTicks = DEFAULT_RANGE_TICKS;

        // Bucket/window currently subscribed; re-subscribe only on a wider tier or window.
        this._subscribedBucketTicks = null;
        this._subscribedWindowTicks = null;

        this._colors = new ChartColors();

        // A live push during a drag still merges immediately; only the redraw is deferred.
        this._isDragging = false;
        this._pendingUpdate = false;
        this._dragStartClientX = 0;
        this._dragStartRange = MIN_RANGE_TICKS;

        // Sim tick of the last push + observed push cadence, for the continuous scroll animation.
        this._lastPushToTick = 0;
        this._estimator = new TickIntervalEstimator();

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._pointerListeners = [
            ["pointerdown", this._onPointerDown], ["pointermove", this._onPointerMove],
            ["pointerup", this._onPointerUp], ["pointercancel", this._onPointerUp],
        ];

        this._buildSkeleton();
        this._buildEmptyState();
        if (width !== null && height !== null) {
            this.setSize(width, height);
        }
        this._scheduleResubscribe(true);

        this._animationFrame = this._animationFrame.bind(this);
        this._rafHandle = requestAnimationFrame(this._animationFrame);
    }

    /**
     * @param {number} width
     * @param {number} height
     * @returns {void}
     */
    setSize(width, height) {
        this._targetWidth = width;
        this._targetHeight = height;
        this._redrawStatic();
    }

    /**
     * @param {string} metric "count" | "sum" | "avg"
     * @returns {void}
     */
    setMetric(metric) {
        if (metric === this._metric) {
            return;
        }
        this._metric = metric;
        this._rebuild();
    }

    /**
     * @param {number|undefined} tickIntervalMs
     * @returns {void}
     */
    setTickIntervalMs(tickIntervalMs) {
        if (tickIntervalMs === undefined) {
            return;
        }
        this._estimator.setKnown(tickIntervalMs);
    }

    /**
     * @param {object|undefined} rollup
     * @returns {void}
     */
    push(rollup) {
        this._rollup = rollup;
        this._recordPush();
        if (this._isDragging) {
            this._pendingUpdate = true;
            return;
        }
        this._rebuild();
    }

    /**
     * @returns {void}
     */
    destroy() {
        if (this._rafHandle !== null) {
            cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }
        this._disposeSkeleton();
        this._emptyEl.remove();
        this._emptyEl = null;
    }

    /**
     * @returns {void}
     * @private
     */
    _buildSkeleton() {
        this._svg = select(this._container).append("svg").style("display", "block");
        const root = this._svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
        this._gGridY = root.append("g");
        this._gAxisX = root.append("g");
        this._gAxisY = root.append("g");

        const clipId = `metrics-line-chart-clip-${this._instanceId}`;
        this._clipRect = this._svg.append("clipPath").attr("id", clipId).append("rect");
        this._gLines = root.append("g").attr("clip-path", `url(#${clipId})`);

        this._overlay = root.append("rect").style("fill", "transparent");
        this._overlay.node().addEventListener("pointerdown", this._onPointerDown);
        this._overlay.node().addEventListener("pointermove", this._onPointerMove);
        this._overlay.node().addEventListener("pointerup", this._onPointerUp);
        this._overlay.node().addEventListener("pointercancel", this._onPointerUp);
        this._overlay.node().addEventListener("wheel", this._onWheel, {passive: false});
    }

    /**
     * @returns {void}
     * @private
     */
    _disposeSkeleton() {
        this._overlay.node().removeEventListener("pointerdown", this._onPointerDown);
        this._overlay.node().removeEventListener("pointermove", this._onPointerMove);
        this._overlay.node().removeEventListener("pointerup", this._onPointerUp);
        this._overlay.node().removeEventListener("pointercancel", this._onPointerUp);
        this._overlay.node().removeEventListener("wheel", this._onWheel);
        this._svg.remove();
        this._svg = null;
    }

    /**
     * @returns {void}
     * @private
     */
    _buildEmptyState() {
        const el = document.createElement("div");
        Object.assign(el.style, {
            position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center",
            color: INK_MUTED, fontSize: "13px", pointerEvents: "none",
        });
        el.textContent = "Waiting for data…";
        this._container.appendChild(el);
        this._emptyEl = el;
    }

    /**
     * @param {number} candidate
     * @returns {number}
     * @private
     */
    _clampRange(candidate) {
        return Math.min(MAX_RANGE_TICKS, Math.max(MIN_RANGE_TICKS, candidate));
    }

    /**
     * Fires onSubscribe for the current zoom's ideal (bucketTicks, windowTicks); zooming in reuses
     * data already on hand.
     * @param {boolean} force always fires, even at the same tier (construction)
     * @returns {void}
     * @private
     */
    _scheduleResubscribe(force) {
        const bucket = selectBucketTicks(this._rangeTicks);
        const window = windowTicksFor(this._rangeTicks, bucket);
        if (!force && bucket === this._subscribedBucketTicks && window <= this._subscribedWindowTicks) {
            return;
        }
        this._subscribedBucketTicks = bucket;
        this._subscribedWindowTicks = window;
        this._estimator.suppressNextSample();
        if (this._onSubscribe !== null) {
            this._onSubscribe(bucket, window);
        }
    }

    /**
     * @param {PointerEvent} event
     * @private
     */
    _onPointerDown(event) {
        if (event.button !== 0) {
            return;
        }
        this._isDragging = true;
        this._overlay.node().setPointerCapture(event.pointerId);
        this._dragStartClientX = event.clientX;
        this._dragStartRange = this._rangeTicks;
        event.preventDefault();
    }

    /**
     * @param {PointerEvent} event
     * @private
     */
    _onPointerMove(event) {
        if (!this._isDragging) {
            return;
        }
        const width = this._plotWidth || 1;
        // Dragged left = zoom in (factor < 1).
        const dragFraction = (this._dragStartClientX - event.clientX) / width;
        const factor = Math.pow(ZOOM_DRAG_STRENGTH, -dragFraction);
        this._rangeTicks = this._clampRange(this._dragStartRange * factor);
        this._redrawStatic();
        this._scheduleResubscribe(false);
    }

    /**
     * @private
     */
    _onPointerUp() {
        if (!this._isDragging) {
            return;
        }
        this._isDragging = false;
        if (this._pendingUpdate) {
            this._pendingUpdate = false;
            this._rebuild();
        }
    }

    /**
     * @param {WheelEvent} event
     * @private
     */
    _onWheel(event) {
        event.preventDefault();
        const factor = event.deltaY < 0 ? WHEEL_ZOOM_IN_FACTOR : WHEEL_ZOOM_OUT_FACTOR;
        this._rangeTicks = this._clampRange(this._rangeTicks * factor);
        this._redrawStatic();
        this._scheduleResubscribe(false);
    }

    /**
     * Fractional sim tick "now": extrapolates past the last push by the observed cadence, capped
     * at one bucket, so scrolling never freezes then jumps.
     * @returns {number}
     * @private
     */
    _virtualNowTick() {
        if (this._estimator.lastPushWallTime === null) {
            return this._lastPushToTick;
        }
        const maxExtrapolationTicks = this._subscribedBucketTicks === null ? 1 : this._subscribedBucketTicks;
        const elapsedTicks = (performance.now() - this._estimator.lastPushWallTime) / this._estimator.intervalMs;
        return this._lastPushToTick + Math.min(maxExtrapolationTicks, Math.max(0, elapsedTicks));
    }

    /**
     * @returns {void}
     * @private
     */
    _resizeToContainer() {
        if (this._svg === null || this._targetWidth === null) {
            return;
        }
        this._svg.attr("width", this._targetWidth).attr("height", this._targetHeight);
        this._plotWidth = Math.max(1, this._targetWidth - MARGIN.left - MARGIN.right);
        this._plotHeight = Math.max(1, this._targetHeight - MARGIN.top - MARGIN.bottom);
        this._xScale.range([0, this._plotWidth]);
        this._yScale.range([this._plotHeight, 0]);
        this._overlay.attr("x", 0).attr("y", 0).attr("width", this._plotWidth).attr("height", this._plotHeight);
        this._clipRect.attr("x", 0).attr("y", 0).attr("width", this._plotWidth).attr("height", this._plotHeight);
    }

    /**
     * Redraws only the line paths — called every animation frame and after anything else changes.
     * @returns {void}
     * @private
     */
    _updateLines() {
        if (this._svg === null) {
            return;
        }
        if (this._latestSeriesData === null || this._latestSeriesData.ticks.length === 0) {
            this._gLines.selectAll("path").remove();
            return;
        }
        // Shifts data right by 2*bucketTicks so the freshest completed point sits at the domain edge.
        const fakeNow = this._virtualNowTick() - 2 * this._latestSeriesData.bucketTicks;
        const lineGenerator = line()
            .defined(d => d.value !== null)
            .x(d => this._xScale(d.tick - fakeNow))
            .y(d => this._yScale(d.value));
        // sort() keeps paint order pinned to each series' persistent color slot.
        this._gLines.selectAll("path").data(this._latestSeriesData.seriesList, d => d.key).join("path")
            .attr("fill", "none")
            .attr("stroke-width", 3)
            .attr("stroke-linejoin", "round")
            .attr("stroke-linecap", "round")
            .attr("stroke", d => this._colors.colorFor(d.key))
            .attr("d", d => lineGenerator(this._latestSeriesData.ticks.map((tick, i) => ({tick, value: d.values[i]}))))
            .sort((a, b) => this._colors.indexFor(a.key) - this._colors.indexFor(b.key));
    }

    /**
     * Redraws the x axis; static between pushes, only resize/zoom change it.
     * @returns {void}
     * @private
     */
    _updateXAxis() {
        this._xScale.domain([-this._rangeTicks, 0]);
        const xTickCount = Math.max(2, Math.floor(this._plotWidth / 70));
        const xAxis = axisBottom(this._xScale)
            .tickValues(integerTicks(-this._rangeTicks, 0, xTickCount))
            .tickFormat(t => String(Math.abs(Math.round(t))))
            .tickSizeOuter(0);
        this._gAxisX.attr("transform", `translate(0,${this._plotHeight})`).call(xAxis);
    }

    /**
     * Redraws the y axis + gridlines; depends on data, so it also runs on every real push.
     * @returns {void}
     * @private
     */
    _updateYAxis() {
        if (this._latestSeriesData === null || this._latestSeriesData.ticks.length === 0) {
            this._gAxisY.selectAll("*").remove();
            this._gGridY.selectAll("*").remove();
            return;
        }
        this._yScale.domain(visibleExtent(
            this._latestSeriesData.ticks, this._latestSeriesData.seriesList, this._rangeTicks,
            this._lastPushToTick - 2 * this._latestSeriesData.bucketTicks,
        ));
        const [yMin, yMax] = this._yScale.domain();
        const yTickValues = this._metric === "avg" ? this._yScale.ticks(5) : integerTicks(yMin, yMax, 5);
        const yFormat = this._metric === "avg" ? formatAvg : formatCount;
        const yAxis = axisLeft(this._yScale).tickValues(yTickValues).tickFormat(yFormat).tickSizeOuter(0);
        this._gAxisY.call(yAxis);
        this._gGridY.selectAll("line").data(yTickValues).join("line")
            .attr("x1", 0).attr("x2", this._plotWidth)
            .attr("y1", d => this._yScale(d)).attr("y2", d => this._yScale(d));
    }

    /**
     * @returns {void}
     * @private
     */
    _applyThemeStrokes() {
        this._gAxisX.selectAll(".domain, .tick line").attr("stroke", INK_MUTED);
        this._gAxisX.selectAll(".tick text").attr("fill", INK);
        this._gAxisY.selectAll(".domain, .tick line").attr("stroke", INK_MUTED);
        this._gAxisY.selectAll(".tick text").attr("fill", INK);
        this._gGridY.selectAll("line").attr("stroke", GRID);
    }

    /**
     * Full redraw for anything that changes the scales themselves.
     * @returns {void}
     * @private
     */
    _redrawStatic() {
        if (this._svg === null) {
            return;
        }
        this._resizeToContainer();
        this._updateXAxis();
        this._updateYAxis();
        this._applyThemeStrokes();
        this._updateLines();
    }

    /**
     * Times the push and tracks data presence; this._rollup is already the merged accumulation.
     * @returns {void}
     * @private
     */
    _recordPush() {
        if (this._rollup === undefined) {
            return;
        }
        this._estimator.recordPush(performance.now(), this._rollup.bucketTicks);
        this._lastPushToTick = this._rollup.toTick;
        this._hasData = this._rollup.bucketTick.length > 0;
        if (this._hasData) {
            this._emptyEl.style.display = "none";
        } else {
            this._emptyEl.style.display = "flex";
        }
    }

    /**
     * @returns {void}
     * @private
     */
    _rebuild() {
        this._latestSeriesData = buildSeries(this._rollup, this._metric);
        this._updateYAxis();
        this._applyThemeStrokes();
        this._updateLines();
    }

    /**
     * @private
     */
    _animationFrame() {
        this._updateLines();
        this._rafHandle = requestAnimationFrame(this._animationFrame);
    }
}
