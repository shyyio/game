import {test} from "node:test";
import assert from "node:assert/strict";

import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {NodeMetricsStore} from "@/server/NodeMetricsStore.js";
import {MetricsSubscribeMessage, MetricsUnsubscribeMessage} from "@/common/MetricsMessages.js";
import {MetricsRollupEvent, MetricsRollupBucketEvent} from "@/common/MetricsEvents.js";
import {
    METRICS_FACT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN, METRICS_QUERY_SCOPE_GLOBAL,
} from "@/common/MetricsFact.js";
import {METRICS_FACT_TYPE_TRADE_EXECUTED} from "@/mods/Market/common/constants.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";

// One-shot/(re)subscribe answers are MetricsRollupEvent, heartbeats MetricsRollupBucketEvent.
function rollupEventsOf(session) {
    return session.events.filter(event => event instanceof MetricsRollupEvent || event instanceof MetricsRollupBucketEvent);
}

test("subscribing answers once immediately, and again on the next push", async () => {
    const modRegistry = ecsModRegistry();
    const store = new NodeMetricsStore(":memory:");
    const game = new Game(modRegistry, new GameEngine(modRegistry), undefined, store);
    await game.init();

    const alice = new CapturingSession(1);
    game.connect(alice);
    alice.events.length = 0;

    game.dispatchMessage(
        new MetricsSubscribeMessage(METRICS_FACT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN, 10, 1000),
        alice,
    );
    await Promise.resolve();
    assert.equal(rollupEventsOf(alice).length, 1);

    game.metrics.record(METRICS_FACT_TYPE_ITEM_PRODUCED, 1, 5, 1);
    await game.metrics.flush();
    // Bucket 0 (ticks 0-9) only completes once the clock reaches 10 (GameMetrics.push()).
    game.simEngine.clock = 10;
    game.metrics.push();
    await Promise.resolve();

    const responses = rollupEventsOf(alice);
    assert.equal(responses.length, 2);
    // Initial answer: MetricsRollupEvent (many buckets); heartbeat: MetricsRollupBucketEvent (one).
    assert.ok(responses[0] instanceof MetricsRollupEvent);
    assert.ok(responses[1] instanceof MetricsRollupBucketEvent);
    assert.equal(responses[1].bucketTick, 0);
    assert.deepEqual(responses[1].category, [5]);
    assert.deepEqual(responses[1].count, [1]);
});

test("unsubscribe stops future pushes", async () => {
    const modRegistry = ecsModRegistry();
    const store = new NodeMetricsStore(":memory:");
    const game = new Game(modRegistry, new GameEngine(modRegistry), undefined, store);
    await game.init();

    const alice = new CapturingSession(1);
    game.connect(alice);
    game.dispatchMessage(
        new MetricsSubscribeMessage(METRICS_FACT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN, 10, 1000),
        alice,
    );
    await Promise.resolve();
    game.dispatchMessage(new MetricsUnsubscribeMessage(METRICS_FACT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN), alice);
    alice.events.length = 0;

    game.metrics.push();
    await Promise.resolve();

    assert.equal(rollupEventsOf(alice).length, 0);
});

test("two sessions sharing a GLOBAL subscription share one push, each their own for OWN", async () => {
    const modRegistry = ecsModRegistry();
    const store = new NodeMetricsStore(":memory:");
    const game = new Game(modRegistry, new GameEngine(modRegistry), undefined, store);
    await game.init();

    const alice = new CapturingSession(1);
    const bob = new CapturingSession(2);
    game.connect(alice);
    game.connect(bob);

    const SIDE_SELL = 0;
    game.metrics.record(METRICS_FACT_TYPE_TRADE_EXECUTED, 1, 7, 100, SIDE_SELL);
    game.metrics.record(METRICS_FACT_TYPE_TRADE_EXECUTED, 2, 7, 200, SIDE_SELL);
    game.metrics.record(METRICS_FACT_TYPE_ITEM_PRODUCED, 1, 42, 1);
    game.metrics.record(METRICS_FACT_TYPE_ITEM_PRODUCED, 2, 99, 1);
    await game.metrics.flush();

    game.dispatchMessage(new MetricsSubscribeMessage(METRICS_FACT_TYPE_TRADE_EXECUTED, METRICS_QUERY_SCOPE_GLOBAL, 10, 1000), alice);
    game.dispatchMessage(new MetricsSubscribeMessage(METRICS_FACT_TYPE_TRADE_EXECUTED, METRICS_QUERY_SCOPE_GLOBAL, 10, 1000), bob);
    game.dispatchMessage(new MetricsSubscribeMessage(METRICS_FACT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN, 10, 1000), alice);
    game.dispatchMessage(new MetricsSubscribeMessage(METRICS_FACT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN, 10, 1000), bob);
    await Promise.resolve();
    alice.events.length = 0;
    bob.events.length = 0;

    // See the previous test: bucket 0 (where every fact above landed) only completes at tick 10.
    game.simEngine.clock = 10;
    game.metrics.push();
    await Promise.resolve();

    const aliceGlobal = rollupEventsOf(alice).find(e => e.metricsType === METRICS_FACT_TYPE_TRADE_EXECUTED);
    const bobGlobal = rollupEventsOf(bob).find(e => e.metricsType === METRICS_FACT_TYPE_TRADE_EXECUTED);
    assert.deepEqual(aliceGlobal.sum, [300]);
    assert.deepEqual(bobGlobal.sum, [300]);

    const aliceOwn = rollupEventsOf(alice).find(e => e.metricsType === METRICS_FACT_TYPE_ITEM_PRODUCED);
    const bobOwn = rollupEventsOf(bob).find(e => e.metricsType === METRICS_FACT_TYPE_ITEM_PRODUCED);
    assert.deepEqual(aliceOwn.category, [42]);
    assert.deepEqual(bobOwn.category, [99]);
});

test("disconnect clears subscriptions so a later push touches nothing for that session", async () => {
    const modRegistry = ecsModRegistry();
    const store = new NodeMetricsStore(":memory:");
    const game = new Game(modRegistry, new GameEngine(modRegistry), undefined, store);
    await game.init();

    const alice = new CapturingSession(1);
    game.connect(alice);
    game.dispatchMessage(
        new MetricsSubscribeMessage(METRICS_FACT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN, 10, 1000),
        alice,
    );
    await Promise.resolve();

    game.disconnect(alice.id);

    // Must not throw resolving a stale session's playerId mid-push.
    assert.doesNotThrow(() => game.metrics.push());
});
