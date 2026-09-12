import {test} from "node:test";
import assert from "node:assert/strict";
import {formatTradeAmount, getSplatColorByAmount, DEBIT_COLOR} from "./splats.js";
import {COIN_COLOR} from "./icons.js";

test("a credit reads with a plus, a debit with a minus", () => {
    assert.equal(formatTradeAmount(100), "+100");
    assert.equal(formatTradeAmount(-100), "-100");
});

test("a big amount abbreviates, so the splat stays short", () => {
    assert.equal(formatTradeAmount(2_500_000), "+2500K");
});

test("the sign picks the color", () => {
    assert.equal(getSplatColorByAmount(1), COIN_COLOR);
    assert.equal(getSplatColorByAmount(-1), DEBIT_COLOR);
});
