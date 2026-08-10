import {test} from "node:test";
import assert from "node:assert/strict";
import {
    BUCKET_LADDER, MAX_HISTORY_TICKS, CHART_METRIC_COUNT, CHART_METRIC_AVG,
    selectBucketTicks, windowTicksFor, buildSeries, integerTicks, visibleExtent, seriesRates,
} from "@/client/MetricsChartData.js";

test("selectBucketTicks picks the largest tier keeping ~10 buckets visible", () => {
    assert.equal(selectBucketTicks(60), BUCKET_LADDER[0]);
    assert.equal(selectBucketTicks(1000), 100);
    assert.equal(selectBucketTicks(9999), 100);
    assert.equal(selectBucketTicks(10_000), 1000);
    assert.equal(selectBucketTicks(1_000_000), 6000);
});

test("windowTicksFor adds two buckets of headroom, capped at MAX_HISTORY_TICKS", () => {
    assert.equal(windowTicksFor(100, 10), 120);
    assert.equal(windowTicksFor(MAX_HISTORY_TICKS, 6000), MAX_HISTORY_TICKS);
});

test("buildSeries fills absent buckets with zero after a series' first observation, null before", () => {
    const rollup = {
        bucketTicks: 10,
        toTick: 45,
        bucketTick: [0, 20, 20],
        category: [1, 1, 2],
        tag: [0, 0, 0],
        count: [3, 5, 2],
        sum: [30, 50, 20],
    };

    const {ticks, seriesList} = buildSeries(rollup, CHART_METRIC_COUNT);

    // Ticks span first bucket to the last completed one (toTick's bucket, 40, is still filling).
    assert.deepEqual(ticks, [0, 10, 20, 30]);
    const first = seriesList.find(series => series.category === 1);
    const second = seriesList.find(series => series.category === 2);
    assert.deepEqual(first.values, [3, 0, 5, 0]);
    // Series 2 first observed at bucket 20: earlier buckets are null, not zero.
    assert.deepEqual(second.values, [null, null, 2, 0]);
});

test("buildSeries avg metric divides sum by count and leaves absent buckets null", () => {
    const rollup = {
        bucketTicks: 10,
        toTick: 35,
        bucketTick: [0, 20],
        category: [1, 1],
        tag: [0, 0],
        count: [4, 2],
        sum: [40, 30],
    };

    const {seriesList} = buildSeries(rollup, CHART_METRIC_AVG);

    assert.deepEqual(seriesList[0].values, [10, null, 15]);
});

test("buildSeries without data returns empty series and the default bucket tier", () => {
    assert.deepEqual(buildSeries(undefined, CHART_METRIC_COUNT), {ticks: [], seriesList: [], bucketTicks: BUCKET_LADDER[0]});
});

test("integerTicks steps on the 1-2-5 ladder and never duplicates labels", () => {
    assert.deepEqual(integerTicks(0, 4, 5), [0, 1, 2, 3, 4]);
    assert.deepEqual(integerTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(integerTicks(-100, 0, 5), [-100, -80, -60, -40, -20, 0]);
    const ticks = integerTicks(0, 3, 10);
    assert.deepEqual(ticks, [...new Set(ticks)]);
});

test("visibleExtent fits only the buckets inside the visible range, with headroom", () => {
    const ticks = [0, 10, 20];
    const seriesList = [{values: [100, 2, 4]}];

    // Range 15 back from tick 25: bucket 0 (value 100) is out of view.
    const [lo, hi] = visibleExtent(ticks, seriesList, 15, 25);

    assert.equal(lo, 0);
    assert.ok(hi > 4 && hi < 100);
});

test("visibleExtent of no visible data spans [0, headroom]", () => {
    const [lo, hi] = visibleExtent([], [], 100, 0);
    assert.equal(lo, 0);
    assert.ok(hi > 1);
});

test("seriesRates averages in-window counts and sorts by rate descending", () => {
    const rollup = {
        bucketTicks: 10,
        toTick: 100,
        bucketTick: [60, 70, 80, 60, 80],
        category: [1, 1, 1, 2, 2],
        tag: [0, 0, 0, 0, 0],
        count: [2, 4, 6, 20, 20],
        sum: [0, 0, 0, 0, 0],
    };

    const rates = seriesRates(rollup, 40, 100);

    assert.equal(rates.length, 2);
    assert.equal(rates[0].key, "2:0");
    assert.equal(rates[0].category, 2);
    assert.equal(rates[0].ratePerTick, 1);
    assert.equal(rates[1].key, "1:0");
    assert.equal(rates[1].ratePerTick, 0.3);
});

test("seriesRates counts only buckets inside [nowTick - rangeTicks, nowTick)", () => {
    const rollup = {
        bucketTicks: 10,
        toTick: 200,
        // 100 is below the window, 200 is at nowTick (excluded); only 150 counts.
        bucketTick: [100, 150, 200],
        category: [1, 1, 1],
        tag: [0, 0, 0],
        count: [999, 5, 999],
        sum: [0, 0, 0],
    };

    const rates = seriesRates(rollup, 60, 200);

    assert.equal(rates[0].ratePerTick, 5 / 60);
});

test("seriesRates clamps the window to the data on hand", () => {
    const rollup = {
        bucketTicks: 10,
        toTick: 50,
        bucketTick: [30, 40],
        category: [1, 1],
        tag: [0, 0],
        count: [4, 6],
        sum: [0, 0],
    };

    // Data starts at tick 30, so a 1000-tick range averages over 50 - 30 = 20 ticks.
    const rates = seriesRates(rollup, 1000, 50);

    assert.equal(rates[0].ratePerTick, 0.5);
});

test("seriesRates keeps a zero-rate row for a series with no in-window buckets", () => {
    const rollup = {
        bucketTicks: 10,
        toTick: 100,
        bucketTick: [10, 90],
        category: [1, 2],
        tag: [0, 0],
        count: [7, 3],
        sum: [0, 0],
    };

    const rates = seriesRates(rollup, 20, 100);

    const stale = rates.find(rate => rate.category === 1);
    assert.equal(stale.ratePerTick, 0);
});

test("seriesRates without data returns no rows", () => {
    assert.deepEqual(seriesRates(undefined, 100, 0), []);
    assert.deepEqual(seriesRates({bucketTicks: 10, toTick: 0, bucketTick: [], category: [], tag: [], count: [], sum: []}, 100, 0), []);
});
