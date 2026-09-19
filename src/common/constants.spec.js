import test from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";

test("a local direction turns into world space by the facing it is stated against", () => {
    assert.equal(Direction.toWorld(Direction.UP, Direction.UP), Direction.UP);
    assert.equal(Direction.toWorld(Direction.UP, Direction.RIGHT), Direction.RIGHT);
    assert.equal(Direction.toWorld(Direction.LEFT, Direction.DOWN), Direction.RIGHT);
    assert.equal(Direction.toWorld(Direction.DOWN, Direction.LEFT), Direction.RIGHT);
});
