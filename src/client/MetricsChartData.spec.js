import {test} from "node:test";
import assert from "node:assert/strict";
import {
    BUCKET_LADDER, MAX_HISTORY_TICKS, CHART_METRIC_COUNT, CHART_METRIC_AVG,
    selectBucketTicks, windowTicksFor, buildSeries, integerTicks, visibleExtent,
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
