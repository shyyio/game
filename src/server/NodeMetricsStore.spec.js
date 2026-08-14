import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {NodeMetricsStore} from "@/server/NodeMetricsStore.js";
import {ClientMetricsStore} from "@/client/state/ClientMetricsStore.js";
import {METRICS_RETENTION_TICKS} from "@/common/AbstractMetricsStore.js";
import {MetricsFact, MetricsRollupRow} from "@/common/MetricsFact.js";
import {METRICS_COARSE_TIERS, METRICS_FOLD_TIER, TIER_LADDER} from "@/common/MetricsTiers.js";

const TYPE = 2;
const PLAYER = 7;
const OTHER_PLAYER = 9;

/**
 * @param {MetricsRollupRow[]} rows
 * @returns {MetricsRollupRow[]}
 */
function sortRows(rows) {
    return rows.sort((x, y) =>
        x.bucketTick - y.bucketTick || x.category - y.category || x.tag - y.tag);
}

/**
 * @returns {string} path to a fresh store file
 */
function tempStorePath() {
    return join(mkdtempSync(join(tmpdir(), "metrics-store-")), "metrics.sqlite3");
}

test("queryRollup buckets by tick, not by wall-clock, and sums amount per (bucket, category, tag)", async () => {
    const store = new NodeMetricsStore(":memory:");
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
    const store = new NodeMetricsStore(":memory:");
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
    const store = new NodeMetricsStore(":memory:");
    await store.recordBatch([
        new MetricsFact(TYPE, 0, PLAYER, 1, 10, 0),
        new MetricsFact(TYPE, 0, OTHER_PLAYER, 1, 20, 0),
    ]);

    const rollup = await store.queryRollup(TYPE, null, 0, 9, 10);

    assert.deepEqual(rollup, [new MetricsRollupRow(0, 1, 0, 2, 30)]);
});

test("a baked tier answers the same rollup the raw facts would, across folded and un-folded ticks", async () => {
    const store = new NodeMetricsStore(":memory:");
    const facts = [];
    for (let tick = 0; tick < METRICS_FOLD_TIER * 2 + 30; tick += 1) {
        facts.push(new MetricsFact(TYPE, tick, PLAYER, tick % 3, tick, 0));
        facts.push(new MetricsFact(TYPE, tick, OTHER_PLAYER, tick % 3, 2 * tick, 1));
    }
    await store.recordBatch(facts);
    // Only the first two windows fold; the remaining 30 ticks stay in the un-baked tail.
    await store.advanceTo(METRICS_FOLD_TIER * 2 + 30);
    // The plain-array store aggregates the same facts, as the reference the baked path must match.
    const reference = new ClientMetricsStore();
    await reference.recordBatch(facts);

    const toTick = METRICS_FOLD_TIER * 2 + 29;
    for (const playerId of [null, PLAYER]) {
        const baked = await store.queryRollup(TYPE, playerId, 0, toTick, METRICS_FOLD_TIER);
        const expected = await reference.queryRollup(TYPE, playerId, 0, toTick, METRICS_FOLD_TIER);
        assert.deepEqual(sortRows(baked), sortRows(expected));
    }
});

test("a coarse tier folds from the same windows without double-counting repeated bakes", async () => {
    const coarse = METRICS_COARSE_TIERS[METRICS_COARSE_TIERS.length - 1];
    const store = new NodeMetricsStore(":memory:");
    const facts = [];
    for (let tick = 0; tick < coarse + METRICS_FOLD_TIER; tick += 1) {
        facts.push(new MetricsFact(TYPE, tick, PLAYER, 1, 1, 0));
    }
    await store.recordBatch(facts);
    // Fold window by window, so the coarse tier accumulates across many partial updates.
    for (let tick = 0; tick <= coarse + METRICS_FOLD_TIER; tick += METRICS_FOLD_TIER) {
        await store.advanceTo(tick);
    }

    const rollup = await store.queryRollup(TYPE, PLAYER, 0, coarse + METRICS_FOLD_TIER - 1, coarse);

    assert.deepEqual(rollup, [
        new MetricsRollupRow(0, 1, 0, coarse, coarse),
        new MetricsRollupRow(coarse, 1, 0, METRICS_FOLD_TIER, METRICS_FOLD_TIER),
    ]);
});

test("a baked query starts at the bucket fromTick falls in, whole rather than clipped", async () => {
    const store = new NodeMetricsStore(":memory:");
    await store.recordBatch([
        new MetricsFact(TYPE, 0, PLAYER, 1, 1, 0),
        new MetricsFact(TYPE, METRICS_FOLD_TIER - 1, PLAYER, 1, 1, 0),
    ]);
    await store.advanceTo(METRICS_FOLD_TIER);

    const rollup = await store.queryRollup(TYPE, PLAYER, METRICS_FOLD_TIER - 1, METRICS_FOLD_TIER - 1, METRICS_FOLD_TIER);

    assert.deepEqual(rollup, [new MetricsRollupRow(0, 1, 0, 2, 2)]);
});

test("reopening a file folds the facts recorded since the last bake, once", async () => {
    const path = tempStorePath();
    const store = new NodeMetricsStore(path);
    const facts = [];
    for (let tick = 0; tick < METRICS_FOLD_TIER * 2; tick += 1) {
        facts.push(new MetricsFact(TYPE, tick, PLAYER, 1, 1, 0));
    }
    await store.recordBatch(facts);
    await store.advanceTo(METRICS_FOLD_TIER);
    await store.close();

    const reopened = new NodeMetricsStore(path);
    const rollup = await reopened.queryRollup(TYPE, PLAYER, 0, METRICS_FOLD_TIER * 2 - 1, METRICS_FOLD_TIER);
    await reopened.close();

    assert.deepEqual(rollup, [
        new MetricsRollupRow(0, 1, 0, METRICS_FOLD_TIER, METRICS_FOLD_TIER),
        new MetricsRollupRow(METRICS_FOLD_TIER, 1, 0, METRICS_FOLD_TIER, METRICS_FOLD_TIER),
    ]);
});

test("buckets from a tier this build doesn't bake are rebuilt instead of folded onto", async () => {
    const path = tempStorePath();
    const store = new NodeMetricsStore(path);
    const facts = [];
    for (let tick = 0; tick < METRICS_FOLD_TIER; tick += 1) {
        facts.push(new MetricsFact(TYPE, tick, PLAYER, 1, 1, 0));
    }
    await store.recordBatch(facts);
    await store.advanceTo(METRICS_FOLD_TIER);
    // Stands in for a build whose ladder has changed since the file was written.
    const offLadderTier = TIER_LADDER[TIER_LADDER.length - 1] + 1;
    store.db.prepare(`
        INSERT INTO "MetricsBucket" (tier, type, player_id, bucket_tick, category, tag, count, sum)
        VALUES (@tier, @type, @player_id, 0, 1, 0, 999, 999)
    `).run({tier: offLadderTier, type: TYPE, player_id: PLAYER});
    await store.close();

    const reopened = new NodeMetricsStore(path);
    const rollup = await reopened.queryRollup(TYPE, PLAYER, 0, METRICS_FOLD_TIER - 1, METRICS_FOLD_TIER);
    await reopened.close();

    assert.deepEqual(rollup, [new MetricsRollupRow(0, 1, 0, METRICS_FOLD_TIER, METRICS_FOLD_TIER)]);
});

test("advanceTo drops facts and buckets more than RETENTION_TICKS behind the latest tick", async () => {
    const store = new NodeMetricsStore(":memory:");
    const LATEST = METRICS_RETENTION_TICKS + METRICS_FOLD_TIER;
    await store.recordBatch([
        new MetricsFact(TYPE, 0, PLAYER, 1, 1, 0),
        new MetricsFact(TYPE, LATEST, PLAYER, 1, 1, 0),
    ]);

    await store.advanceTo(LATEST + METRICS_FOLD_TIER);

    // The un-baked tier reads facts, the baked one reads buckets; the aged-out tick is gone from both.
    const facts = await store.queryRollup(TYPE, PLAYER, 0, LATEST, TIER_LADDER[0]);
    assert.deepEqual(facts.map(row => row.bucketTick), [LATEST]);
    const buckets = await store.queryRollup(TYPE, PLAYER, 0, LATEST, METRICS_FOLD_TIER);
    assert.deepEqual(buckets, [new MetricsRollupRow(LATEST, 1, 0, 1, 1)]);
});
