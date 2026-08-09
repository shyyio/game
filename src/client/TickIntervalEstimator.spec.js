import {test} from "node:test";
import assert from "node:assert/strict";
import {TickIntervalEstimator} from "@/client/TickIntervalEstimator.js";
import {DEFAULT_TICK_MS} from "@/common/constants.js";

test("starts at the default and EMAs toward the observed per-tick push cadence", () => {
    const estimator = new TickIntervalEstimator();
    assert.equal(estimator.intervalMs, DEFAULT_TICK_MS);

    estimator.recordPush(0, 10);
    // 4000ms gap over 10 ticks = 400ms/tick sample.
    estimator.recordPush(4000, 10);

    assert.ok(estimator.intervalMs < DEFAULT_TICK_MS);
    assert.ok(estimator.intervalMs > 400);
});

test("setKnown pins the interval; later samples are ignored", () => {
    const estimator = new TickIntervalEstimator();
    estimator.setKnown(250);
    estimator.recordPush(0, 10);
    estimator.recordPush(9000, 10);

    assert.equal(estimator.intervalMs, 250);
});

test("suppressNextSample skips one sample (a subscribe's immediate reply)", () => {
    const estimator = new TickIntervalEstimator();
    estimator.recordPush(0, 10);
    estimator.suppressNextSample();
    // Would be a 100ms/tick sample; suppressed, so the estimate stays put.
    estimator.recordPush(1000, 10);

    assert.equal(estimator.intervalMs, DEFAULT_TICK_MS);
    assert.equal(estimator.lastPushWallTime, 1000);
});

test("out-of-bounds samples (tab sleep, burst) don't feed the estimate", () => {
    const estimator = new TickIntervalEstimator();
    estimator.recordPush(0, 10);
    // 10ms/tick — below the sanity floor.
    estimator.recordPush(100, 10);
    // 60s/tick — above the ceiling.
    estimator.recordPush(600_100, 10);

    assert.equal(estimator.intervalMs, DEFAULT_TICK_MS);
});
