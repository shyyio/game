import {test} from "node:test";
import assert from "node:assert/strict";
import {ClientMetricsStore} from "@/client/ClientMetricsStore.js";
import {MetricsEvent, MetricsRollupRow} from "@/common/MetricsEvent.js";

const TYPE = 2;
const PLAYER = 7;
const OTHER_PLAYER = 9;

test("queryRollup buckets by tick and sums amount per (bucket, category, tag), matching NodeMetricsStore", async () => {
    const store = new ClientMetricsStore();
    const events = [];
    for (let tick = 0; tick < 25; tick += 1) {
        events.push(new MetricsEvent(TYPE, tick, PLAYER, 42, 1, 0));
    }
    await store.recordBatch(events);

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
        new MetricsEvent(TYPE, 0, PLAYER, 1, 100, 0), // sell
        new MetricsEvent(TYPE, 1, PLAYER, 1, 200, 1), // buy, same bucket+a, different side
        new MetricsEvent(TYPE, 2, PLAYER, 2, 50, 0), // different itemType
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
        new MetricsEvent(TYPE, 0, PLAYER, 1, 10, 0),
        new MetricsEvent(TYPE, 0, OTHER_PLAYER, 1, 20, 0),
    ]);

    const rollup = await store.queryRollup(TYPE, null, 0, 9, 10);

    assert.deepEqual(rollup, [new MetricsRollupRow(0, 1, 0, 2, 30)]);
});

test("queryRange ignores events outside the tick range", async () => {
    const store = new ClientMetricsStore();
    await store.recordBatch([
        new MetricsEvent(TYPE, 5, PLAYER, 1, 1, 0),
        new MetricsEvent(TYPE, 1, PLAYER, 1, 1, 0),
        new MetricsEvent(TYPE, 100, PLAYER, 1, 1, 0), // outside range
    ]);

    const rows = await store.queryRange(TYPE, PLAYER, 0, 10);

    assert.deepEqual(rows.map(row => row.tick).sort((x, y) => x - y), [1, 5]);
});

test("recordTicks is idempotent on tick and queryTickTimestamps returns them in order", async () => {
    const store = new ClientMetricsStore();
    await store.recordTicks([{tick: 3, timestamp: 3000}]);
    await store.recordTicks([{tick: 1, timestamp: 1000}, {tick: 3, timestamp: 9999}]);

    const rows = await store.queryTickTimestamps(0, 10);

    assert.deepEqual(rows, [{tick: 1, timestamp: 1000}, {tick: 3, timestamp: 3000}]);
});

test("events and ticks older than RETENTION_TICKS behind the latest tick are pruned", async () => {
    const store = new ClientMetricsStore();
    const RETENTION_TICKS = 50_000;

    await store.recordBatch([new MetricsEvent(TYPE, 0, PLAYER, 1, 1, 0)]);
    await store.recordTicks([{tick: 0, timestamp: 0}]);
    await store.recordBatch([new MetricsEvent(TYPE, RETENTION_TICKS + 10, PLAYER, 1, 1, 0)]);
    await store.recordTicks([{tick: RETENTION_TICKS + 10, timestamp: 999}]);

    const events = await store.queryRange(TYPE, PLAYER, 0, RETENTION_TICKS + 10);
    const ticks = await store.queryTickTimestamps(0, RETENTION_TICKS + 10);

    assert.deepEqual(events.map(e => e.tick), [RETENTION_TICKS + 10]);
    assert.deepEqual(ticks.map(t => t.tick), [RETENTION_TICKS + 10]);
});
