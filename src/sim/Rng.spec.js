import {test} from "node:test";
import assert from "node:assert/strict";
import {deterministicRoll} from "./Rng.js";

test("deterministicRoll is stable for the same inputs", () => {
    assert.equal(deterministicRoll(42, 7), deterministicRoll(42, 7));
});

test("deterministicRoll varies across inputs", () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i += 1) {
        seen.add(deterministicRoll(42, i));
    }
    assert.ok(seen.size > 990, "near-1000 distinct rolls across 1000 distinct seeds");
});

test("deterministicRoll stays within [0, 1)", () => {
    for (let i = 0; i < 1000; i += 1) {
        const roll = deterministicRoll(i * 31, i);
        assert.ok(roll >= 0 && roll < 1, `roll ${roll} out of range`);
    }
});

test("deterministicRoll is roughly uniform across a large sample", () => {
    let below = 0;
    const samples = 20_000;
    for (let i = 0; i < samples; i += 1) {
        if (deterministicRoll(i, i * 2 + 1) < 0.5) {
            below += 1;
        }
    }
    const fraction = below / samples;
    assert.ok(fraction > 0.47 && fraction < 0.53, `expected ~0.5 below threshold, got ${fraction}`);
});
