import {test} from "node:test";
import assert from "node:assert/strict";
import {ToolGrid} from "@/client/hud/ToolGrid.js";

// Wide enough that the mod-tool range below sits within one row.
const COLUMNS = 5;
const LEFT = 100;
const TOP = 10;
const SLOT_SIZE = 56;
// A cell reserves a label strip under its slot, so rows step further than columns do.
const CELL_HEIGHT = 90;
const COLUMN_GAP = 12;
const ROW_GAP = 12;

// The first mod tool sits past the none cell and one core tool.
const FIRST_MOD_SLOT = 2;

/**
 * @returns {ToolGrid}
 */
function build() {
    return new ToolGrid({
        columns: COLUMNS,
        left: LEFT,
        top: TOP,
        slotSize: SLOT_SIZE,
        cellHeight: CELL_HEIGHT,
        columnGap: COLUMN_GAP,
        rowGap: ROW_GAP,
    });
}

/**
 * The center of the slot at `flatIndex`, where a dragged icon reads as being over it.
 * @param {ToolGrid} grid
 * @param {number} flatIndex
 * @returns {{x: number, y: number}}
 */
function slotCenter(grid, flatIndex) {
    const position = grid.slotPosition(flatIndex);
    return {x: position.x + SLOT_SIZE / 2, y: position.y + SLOT_SIZE / 2};
}

test("the first slot rests at the grid origin", () => {
    assert.deepEqual(build().slotPosition(0), {x: LEFT, y: TOP});
});

test("slots step by the slot size plus the gap across a row", () => {
    const grid = build();
    assert.deepEqual(grid.slotPosition(1), {x: LEFT + SLOT_SIZE + COLUMN_GAP, y: TOP});
    assert.deepEqual(grid.slotPosition(2), {x: LEFT + (SLOT_SIZE + COLUMN_GAP) * 2, y: TOP});
});

test("the row after the last column wraps back to the left, stepping by the cell height", () => {
    assert.deepEqual(build().slotPosition(COLUMNS), {x: LEFT, y: TOP + CELL_HEIGHT + ROW_GAP});
});

test("a point on a slot's center picks that slot", () => {
    const grid = build();
    const center = slotCenter(grid, FIRST_MOD_SLOT + 1);
    assert.equal(grid.nearestSlot(center.x, center.y, FIRST_MOD_SLOT, 4), 1);
});

test("nearestSlot counts from the first slot of the range, not from the grid origin", () => {
    const grid = build();
    const center = slotCenter(grid, FIRST_MOD_SLOT);
    assert.equal(grid.nearestSlot(center.x, center.y, FIRST_MOD_SLOT, 4), 0);
});

test("a point drifting past a slot's halfway mark picks up the next slot", () => {
    const grid = build();
    const center = slotCenter(grid, FIRST_MOD_SLOT);
    const step = SLOT_SIZE + COLUMN_GAP;
    assert.equal(grid.nearestSlot(center.x + step / 2 - 1, center.y, FIRST_MOD_SLOT, 4), 0);
    assert.equal(grid.nearestSlot(center.x + step / 2 + 1, center.y, FIRST_MOD_SLOT, 4), 1);
});

test("a point dragged off past the end of the range clamps to the last slot in it", () => {
    const grid = build();
    const firstRowY = slotCenter(grid, FIRST_MOD_SLOT).y;
    assert.equal(grid.nearestSlot(LEFT + SLOT_SIZE * 100, firstRowY, FIRST_MOD_SLOT, 2), 1);
});

test("nearestSlot over an empty range throws", () => {
    assert.throws(() => build().nearestSlot(0, 0, FIRST_MOD_SLOT, 0));
});
