// MetricsLineChart's pure data shaping — no DOM/d3, so it's spec-testable.

// Bucket widths offered as zoom tiers; re-subscribe only fires on a tier change.
export const BUCKET_LADDER = [10, 100, 1000, 6000];
// 7 days at the default tick rate — cap on how much history gets requested.
export const MAX_HISTORY_TICKS = 1_008_000;

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
 * @param {object|undefined} rollup the flat {bucketTick, category, tag, count, sum, bucketTicks, toTick} shape
 * @param {string} metric "count" | "sum" | "avg"
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
 * @param {{count: number, sum: number}|undefined} point
 * @param {string} metric
 * @returns {number|null}
 */
function valueAt(point, metric) {
    if (point === undefined) {
        if (metric === "avg") {
            return null;
        }
        return 0;
    }
    if (metric === "sum") {
        return point.sum;
    }
    if (metric === "avg") {
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
