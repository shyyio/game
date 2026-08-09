import {test} from "node:test";
import assert from "node:assert/strict";

import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {NodeMetricsStore} from "@/server/NodeMetricsStore.js";
import {MetricsRollupRequestMessage} from "@/common/MetricsMessages.js";
import {MetricsRollupEvent, MetricsRollupBucketEvent} from "@/common/MetricsQueryEvents.js";
import {
    METRICS_EVENT_TYPE_ITEM_PRODUCED, METRICS_EVENT_TYPE_TRADE_EXECUTED,
    METRICS_QUERY_SCOPE_OWN, METRICS_QUERY_SCOPE_GLOBAL,
} from "@/common/MetricsEvent.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";

function rollupEventOf(session) {
    return session.events.find(event => event instanceof MetricsRollupEvent);
}

test("OWN scope answers only the requesting session's own player", async () => {
    const modRegistry = ecsModRegistry();
    const store = new NodeMetricsStore(":memory:");
    const game = new Game(modRegistry, new GameEngine(modRegistry), undefined, store);
    await game.init();

    const alice = new CapturingSession(1);
    const bob = new CapturingSession(2);
    game.connect(alice);
    game.connect(bob);

    game.metrics.record(METRICS_EVENT_TYPE_ITEM_PRODUCED, 1, 42, 100);
    game.metrics.record(METRICS_EVENT_TYPE_ITEM_PRODUCED, 2, 42, 999);
    await game.metrics.flush();

    game.dispatchMessage(
        new MetricsRollupRequestMessage(METRICS_EVENT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN, 0, 100, 10),
        alice,
    );
    await Promise.resolve();

    const response = rollupEventOf(alice);
    assert.ok(response !== undefined);
    assert.equal(response.scope, METRICS_QUERY_SCOPE_OWN);
    assert.equal(response.metricsType, METRICS_EVENT_TYPE_ITEM_PRODUCED);
    // category/tag are dictionary-encoded: one distinct series listed once, rows reference it by index.
    assert.deepEqual(response.seriesCategory, [42]);
    assert.deepEqual(response.seriesIndex, [0]);
    assert.deepEqual(response.count, [1]);
    assert.deepEqual(response.sum, [100]);
});

test("GLOBAL scope is unscoped across every player, for an allowed type", async () => {
    const modRegistry = ecsModRegistry();
    const store = new NodeMetricsStore(":memory:");
    const game = new Game(modRegistry, new GameEngine(modRegistry), undefined, store);
    await game.init();

    const alice = new CapturingSession(1);
    game.connect(alice);

    const SIDE_SELL = 0;
    game.metrics.record(METRICS_EVENT_TYPE_TRADE_EXECUTED, 1, 7, 100, SIDE_SELL);
    game.metrics.record(METRICS_EVENT_TYPE_TRADE_EXECUTED, 2, 7, 200, SIDE_SELL);
    await game.metrics.flush();

    game.dispatchMessage(
        new MetricsRollupRequestMessage(METRICS_EVENT_TYPE_TRADE_EXECUTED, METRICS_QUERY_SCOPE_GLOBAL, 0, 100, 10),
        alice,
    );
    await Promise.resolve();

    const response = rollupEventOf(alice);
    assert.deepEqual(response.seriesCategory, [7]);
    assert.deepEqual(response.seriesIndex, [0]);
    assert.deepEqual(response.count, [2]);
    assert.deepEqual(response.sum, [300]);
});

test("validate() rejects GLOBAL scope for a type not on the public allowlist", () => {
    const message = new MetricsRollupRequestMessage(
        METRICS_EVENT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_GLOBAL, 0, 100, 10,
    );
    assert.equal(message.validate(null, null), false);
});

test("validate() rejects a malformed range/bucket width", () => {
    assert.equal(
        new MetricsRollupRequestMessage(METRICS_EVENT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN, 100, 0, 10)
            .validate(null, null),
        false,
    );
    assert.equal(
        new MetricsRollupRequestMessage(METRICS_EVENT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN, 0, 100, 0)
            .validate(null, null),
        false,
    );
});

test("MetricsRollupRequestMessage and MetricsRollupEvent round-trip the wire codec", async () => {
    const modRegistry = ecsModRegistry();
    const {WireRegistry} = await import("@/common/wire.js");
    const wire = new WireRegistry(modRegistry);

    const message = new MetricsRollupRequestMessage(METRICS_EVENT_TYPE_TRADE_EXECUTED, METRICS_QUERY_SCOPE_GLOBAL, 0, 100, 10);
    const decodedMessage = wire.decode(wire.encode(message));
    assert.deepEqual(decodedMessage, message);

    // 3 rows across 2 buckets, one series (category 7) reused in both — exercises both dictionaries.
    const event = new MetricsRollupEvent(
        METRICS_EVENT_TYPE_TRADE_EXECUTED, METRICS_QUERY_SCOPE_GLOBAL, 10, 100,
        [0, 10], [2, 1], [7, 9], [0, 1], [0, 1, 0], [2, 1, 3], [300, 150, 90],
    );
    const decodedEvent = wire.decode(wire.encode(event));
    assert.deepEqual(decodedEvent, event);
});

test("MetricsRollupBucketEvent round-trips the wire codec, bucketTick a scalar not an array", async () => {
    const modRegistry = ecsModRegistry();
    const {WireRegistry} = await import("@/common/wire.js");
    const wire = new WireRegistry(modRegistry);

    const event = new MetricsRollupBucketEvent(
        METRICS_EVENT_TYPE_TRADE_EXECUTED, METRICS_QUERY_SCOPE_GLOBAL, 10, 100, 90, [7, 7], [0, 1], [2, 1], [300, 150], 1000,
    );
    const decodedEvent = wire.decode(wire.encode(event));
    assert.deepEqual(decodedEvent, event);
    assert.equal(typeof decodedEvent.bucketTick, "number");
});
