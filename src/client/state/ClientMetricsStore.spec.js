import {test} from "node:test";
import assert from "node:assert/strict";
import {ClientMetricsStore} from "@/client/state/ClientMetricsStore.js";
import {METRICS_RETENTION_TICKS} from "@/common/AbstractMetricsStore.js";
import {MetricsFact, MetricsRollupRow} from "@/common/MetricsFact.js";

const TYPE = 2;
const PLAYER = 7;
const OTHER_PLAYER = 9;

test("queryRollup buckets by tick and sums amount per (bucket, category, tag), matching NodeMetricsStore", async () => {
    const store = new ClientMetricsStore();
    const facts = [];
    for (let tick = 0; tick < 25; tick += 1) {
        facts.push(new MetricsFact(TYPE, tick, PLAYER, 42, 1, 0));
    }
    await store.recordBatch(facts);

    const rollup = await store.queryRollup(TYPE, PLAYER, 0, 24, 10);

    assert.deepEqual(rollup, [
        new MetricsRollupRow(0, 42, 0, 10, 10),
        new MetricsRollupRow(10, 42, 0, 10, 10),
        new MetricsRollupRow(20, 42, 0, 5, 5),
    ]);
});

test("queryRollup keeps category and tag as separate groups within the same bucket", async () => {
    const store = new ClientMetricsStore();
    await store.recordBatch([
        new MetricsFact(TYPE, 0, PLAYER, 1, 100, 0), // sell
        new MetricsFact(TYPE, 1, PLAYER, 1, 200, 1), // buy, same bucket+a, different side
        new MetricsFact(TYPE, 2, PLAYER, 2, 50, 0), // different itemType
    ]);

    const rollup = await store.queryRollup(TYPE, PLAYER, 0, 9, 10);

    assert.deepEqual(rollup.sort((x, y) => x.category - y.category || x.tag - y.tag), [
        new MetricsRollupRow(0, 1, 0, 1, 100),
        new MetricsRollupRow(0, 1, 1, 1, 200),
        new MetricsRollupRow(0, 2, 0, 1, 50),
    ]);
});

test("queryRollup with playerId null is unscoped across every player", async () => {
    const store = new ClientMetricsStore();
    await store.recordBatch([
        new MetricsFact(TYPE, 0, PLAYER, 1, 10, 0),
        new MetricsFact(TYPE, 0, OTHER_PLAYER, 1, 20, 0),
    ]);

    const rollup = await store.queryRollup(TYPE, null, 0, 9, 10);

    assert.deepEqual(rollup, [new MetricsRollupRow(0, 1, 0, 2, 30)]);
});

test("pruneTo drops facts more than RETENTION_TICKS behind the latest tick", async () => {
    const store = new ClientMetricsStore();
    const LATEST = METRICS_RETENTION_TICKS + 10;
    await store.recordBatch([new MetricsFact(TYPE, 0, PLAYER, 1, 1, 0)]);
    await store.recordBatch([new MetricsFact(TYPE, LATEST, PLAYER, 1, 1, 0)]);

    await store.advanceTo(LATEST);

    const rollup = await store.queryRollup(TYPE, PLAYER, 0, LATEST, 10);
    assert.deepEqual(rollup.map(row => row.bucketTick), [METRICS_RETENTION_TICKS + 10]);
});
