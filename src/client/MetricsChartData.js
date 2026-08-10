// MetricsLineChart's pure data shaping — no DOM/d3, so it's spec-testable.

// What buildSeries plots per bucket.
export const CHART_METRIC_COUNT = "count";
export const CHART_METRIC_SUM = "sum";
export const CHART_METRIC_AVG = "avg";

// Bucket widths offered as zoom tiers; re-subscribe only fires on a tier change.
export const BUCKET_LADDER = [10, 100, 1000, 6000];
// 7 days at the default tick rate — cap on how much history gets requested.
export const MAX_HISTORY_TICKS = 1_008_000;

// Zoom bounds on the visible range; the max leaves windowTicksFor's headroom inside the history cap.
export const MIN_RANGE_TICKS = 60;
export const MAX_RANGE_TICKS = MAX_HISTORY_TICKS - 2 * BUCKET_LADDER[BUCKET_LADDER.length - 1];

// Headroom above the max value so the topmost line clears the plot's top edge.
const Y_MAX_HEADROOM = 1.1;

/**
 * Largest ladder entry keeping at least ~10 buckets across the visible range.
 * @param {number} rangeTicks
 * @returns {number}
 */
export function selectBucketTicks(rangeTicks) {
    let selected = BUCKET_LADDER[0];
    for (const candidate of BUCKET_LADDER) {
        if (candidate * 10 <= rangeTicks) {
            selected = candidate;
        }
    }
    return selected;
}

/**
 * History window to request: visible range plus 2 buckets of headroom.
 * @param {number} rangeTicks
 * @param {number} bucketTicks
 * @returns {number}
 */
export function windowTicksFor(rangeTicks, bucketTicks) {
    return Math.min(rangeTicks + 2 * bucketTicks, MAX_HISTORY_TICKS);
}

/**
 * Groups a rollup's flat rows into one series per (category, tag); an absent bucket is a real zero, not missing data.
 * @param {MetricsRollup|undefined} rollup
 * @param {string} metric CHART_METRIC_*
 * @returns {{ticks: number[], seriesList: {key: string, category: number, tag: number, values: (number|null)[]}[], bucketTicks: number}}
 */
export function buildSeries(rollup, metric) {
    if (rollup === undefined || rollup.bucketTick.length === 0) {
        const bucketTicks = rollup === undefined ? BUCKET_LADDER[0] : rollup.bucketTicks;
        return {ticks: [], seriesList: [], bucketTicks};
    }
    const byKey = new Map();
    let minBucketTick = Infinity;
    for (let i = 0; i < rollup.bucketTick.length; i += 1) {
        if (rollup.bucketTick[i] < minBucketTick) {
            minBucketTick = rollup.bucketTick[i];
        }
        const key = `${rollup.category[i]}:${rollup.tag[i]}`;
        let entry = byKey.get(key);
        if (entry === undefined) {
            entry = {category: rollup.category[i], tag: rollup.tag[i], points: new Map(), firstTick: Infinity};
            byKey.set(key, entry);
        }
        entry.points.set(rollup.bucketTick[i], {count: rollup.count[i], sum: rollup.sum[i]});
        if (rollup.bucketTick[i] < entry.firstTick) {
            entry.firstTick = rollup.bucketTick[i];
        }
    }
    const currentBucket = Math.floor(rollup.toTick / rollup.bucketTicks) * rollup.bucketTicks;
    const ticks = [];
    for (let tick = minBucketTick; tick < currentBucket; tick += rollup.bucketTicks) {
        ticks.push(tick);
    }
    const seriesList = [...byKey.entries()].map(([key, entry]) => ({
        key,
        category: entry.category,
        tag: entry.tag,
        // Before the series' first observed bucket it didn't exist yet, distinct from a real zero after.
        values: ticks.map(tick => tick < entry.firstTick ? null : valueAt(entry.points.get(tick), metric)),
    }));
    return {ticks, seriesList, bucketTicks: rollup.bucketTicks};
}

/**
 * One series' average production rate over the visible window.
 */
export class SeriesRate {

    /**
     * @param {string} key
     * @param {number} category
     * @param {number} tag
     * @param {number} ratePerTick
     */
    constructor(
        key,
        category,
        tag,
        ratePerTick,
    ) {
        this.key = key;
        this.category = category;
        this.tag = tag;
        this.ratePerTick = ratePerTick;
    }
}

/**
 * Per-series count rate over [nowTick - rangeTicks, nowTick), sorted by rate descending. The
 * window clamps to the data actually on hand, so a fresh subscription isn't diluted by empty
 * history; an absent bucket inside the window is a real zero.
 * @param {MetricsRollup|undefined} rollup
 * @param {number} rangeTicks
 * @param {number} nowTick - freshest tick to count up to (the chart's shifted "now")
 * @returns {SeriesRate[]}
 */
export function seriesRates(rollup, rangeTicks, nowTick) {
    if (rollup === undefined || rollup.bucketTick.length === 0) {
        return [];
    }
    let minBucketTick = Infinity;
    for (let i = 0; i < rollup.bucketTick.length; i += 1) {
        if (rollup.bucketTick[i] < minBucketTick) {
            minBucketTick = rollup.bucketTick[i];
        }
    }
    const minTick = nowTick - rangeTicks;
    const windowTicks = Math.min(rangeTicks, nowTick - minBucketTick);
    if (windowTicks <= 0) {
        return [];
    }
    // Every series in the rollup gets a row (matching the chart's lines); only in-window
    // buckets count toward its rate.
    const byKey = new Map();
    for (let i = 0; i < rollup.bucketTick.length; i += 1) {
        const key = `${rollup.category[i]}:${rollup.tag[i]}`;
        let entry = byKey.get(key);
        if (entry === undefined) {
            entry = {category: rollup.category[i], tag: rollup.tag[i], total: 0};
            byKey.set(key, entry);
        }
        if (rollup.bucketTick[i] >= minTick && rollup.bucketTick[i] < nowTick) {
            entry.total += rollup.count[i];
        }
    }
    const rates = [...byKey.entries()].map(([key, entry]) =>
        new SeriesRate(key, entry.category, entry.tag, entry.total / windowTicks));
    rates.sort((a, b) => {
        if (b.ratePerTick !== a.ratePerTick) {
            return b.ratePerTick - a.ratePerTick;
        }
        return a.key.localeCompare(b.key);
    });
    return rates;
}

/**
 * @param {{count: number, sum: number}|undefined} point
 * @param {string} metric CHART_METRIC_*
 * @returns {number|null}
 */
function valueAt(point, metric) {
    if (point === undefined) {
        if (metric === CHART_METRIC_AVG) {
            return null;
        }
        return 0;
    }
    if (metric === CHART_METRIC_SUM) {
        return point.sum;
    }
    if (metric === CHART_METRIC_AVG) {
        return point.sum / point.count;
    }
    return point.count;
}

// 1-2-5 ladder (floor 1) so integer-rounded tick labels never duplicate.
function integerTickStep(span, targetCount) {
    const rawStep = span / Math.max(1, targetCount);
    if (rawStep <= 1) {
        return 1;
    }
    const power = Math.floor(Math.log10(rawStep));
    const base = 10 ** power;
    for (const multiple of [1, 2, 5, 10]) {
        const step = multiple * base;
        if (step >= rawStep) {
            return Math.max(1, Math.round(step));
        }
    }
    return Math.max(1, Math.round(10 * base));
}

/**
 * @param {number} min
 * @param {number} max
 * @param {number} targetCount
 * @returns {number[]}
 */
export function integerTicks(min, max, targetCount) {
    const step = integerTickStep(max - min, targetCount);
    const start = Math.ceil(min / step) * step;
    const values = [];
    for (let tick = start; tick <= max; tick += step) {
        values.push(tick);
    }
    return values;
}

/**
 * Auto-fits the y domain to what's visible in [nowTick - rangeTicks, nowTick].
 * @param {number[]} ticks
 * @param {{values: (number|null)[]}[]} seriesList
 * @param {number} rangeTicks
 * @param {number} nowTick
 * @returns {[number, number]}
 */
export function visibleExtent(ticks, seriesList, rangeTicks, nowTick) {
    const minTick = nowTick - rangeTicks;
    let lo = 0;
    let hi = 0;
    let any = false;
    for (const series of seriesList) {
        for (let i = 0; i < ticks.length; i += 1) {
            if (ticks[i] < minTick) {
                continue;
            }
            const value = series.values[i];
            if (value === null) {
                continue;
            }
            if (!any) {
                lo = value;
                hi = value;
                any = true;
            } else if (value > hi) {
                hi = value;
            }
        }
    }
    if (!any || lo === hi) {
        return [0, Math.max(1, hi) * Y_MAX_HEADROOM];
    }
    return [Math.min(0, lo), hi * Y_MAX_HEADROOM];
}
