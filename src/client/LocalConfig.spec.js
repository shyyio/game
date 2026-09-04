import {test} from "node:test";
import assert from "node:assert/strict";
import {LocalConfig} from "@/client/LocalConfig.js";
import {DEFAULT_TICK_MS} from "@/common/constants.js";

test("an empty config is a random seed at the default tick", () => {
    const config = LocalConfig.parse({});
    assert.equal(config.seed, null);
    assert.equal(config.tickMs, DEFAULT_TICK_MS);
});

test("a config round-trips through JSON", () => {
    const json = LocalConfig.parse({seed: 5, tickMs: 300}).toJSON();
    assert.deepEqual(json, {seed: 5, tickMs: 300});
    assert.deepEqual(LocalConfig.parse(json).toJSON(), json);
});

test("an unknown key, a bad seed, and a bad tick are refused", () => {
    assert.throws(() => LocalConfig.parse({speed: 1}), /Unknown key "speed"/);
    assert.throws(() => LocalConfig.parse({seed: -1}), /seed/);
    assert.throws(() => LocalConfig.parse({tickMs: 0}), /tickMs/);
});
