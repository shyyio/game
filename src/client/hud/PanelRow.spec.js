import {test} from "node:test";
import assert from "node:assert/strict";
import {Graphics} from "pixi.js";
import {PanelRow, ROW_HEIGHT, ROW_GAP} from "@/client/hud/PanelRow.js";

const ROW_WIDTH = 400;

/**
 * A block of the given size, standing in for a button or a text.
 * @param {number} width
 * @param {number} [height]
 * @returns {Graphics}
 */
function block(width, height = ROW_HEIGHT) {
    return new Graphics().rect(0, 0, width, height).fill(0xffffff);
}

test("leading items flow from the left, one gap apart", () => {
    const row = new PanelRow(ROW_WIDTH);
    const first = row.leading(block(80));
    const second = row.leading(block(50));
    row.layout();

    assert.equal(first.x, 0);
    assert.equal(second.x, 80 + ROW_GAP);
});

test("trailing items pin to the right and stack leftward", () => {
    const row = new PanelRow(ROW_WIDTH);
    const first = row.trailing(block(40));
    const second = row.trailing(block(30));
    row.layout();

    assert.equal(first.x, ROW_WIDTH - 40);
    assert.equal(second.x, ROW_WIDTH - 40 - ROW_GAP - 30);
});

test("a short item is centered on the row", () => {
    const row = new PanelRow(ROW_WIDTH);
    const short = row.leading(block(80, 20));
    row.layout();

    assert.equal(short.y, (ROW_HEIGHT - 20) / 2);
});

test("a full-height item sits at the top", () => {
    const row = new PanelRow(ROW_WIDTH);
    const tall = row.leading(block(80, ROW_HEIGHT));
    row.layout();

    assert.equal(tall.y, 0);
});

test("a spacer advances the flow by exactly its width", () => {
    const row = new PanelRow(ROW_WIDTH);
    row.spacer(16);
    const after = row.leading(block(80));
    row.layout();

    assert.equal(after.x, 16);
});

test("a leading gap override sets the space after that item", () => {
    const row = new PanelRow(ROW_WIDTH);
    row.leading(block(20), 14);
    const after = row.leading(block(80));
    row.layout();

    assert.equal(after.x, 20 + 14);
});

test("a trailing gap override sets the space before that item", () => {
    const row = new PanelRow(ROW_WIDTH);
    const first = row.trailing(block(40), 20);
    const second = row.trailing(block(30));
    row.layout();

    assert.equal(first.x, ROW_WIDTH - 40);
    assert.equal(second.x, ROW_WIDTH - 40 - 20 - 30);
});

test("a fill takes the width the other items leave", () => {
    const row = new PanelRow(ROW_WIDTH);
    row.trailing(block(70));
    let given = null;
    row.fill((width) => {
        given = width;
        return block(width);
    });
    row.layout();

    assert.equal(given, ROW_WIDTH - 70 - ROW_GAP);
    assert.equal(row.overflow, 0);
});

test("a fill measures against a trailing item added after it", () => {
    const row = new PanelRow(ROW_WIDTH);
    let given = null;
    row.fill((width) => {
        given = width;
        return block(width);
    });
    row.trailing(block(70));
    row.layout();

    assert.equal(given, ROW_WIDTH - 70 - ROW_GAP);
});

test("a fill sits between the leading flow and the trailing items", () => {
    const row = new PanelRow(ROW_WIDTH);
    row.leading(block(50));
    row.trailing(block(70));
    const filled = row.fill((width) => block(width));
    row.layout();

    const fillChild = row.children[row.children.length - 1];
    assert.equal(fillChild.x, 50 + ROW_GAP);
    assert.equal(fillChild.width, ROW_WIDTH - 50 - 70 - ROW_GAP * 2);
    assert.equal(filled, undefined);
});

test("a row that fits reports no overflow", () => {
    const row = new PanelRow(ROW_WIDTH);
    row.leading(block(200));
    row.trailing(block(100));
    row.layout();

    assert.equal(row.overflow, 0);
});

test("a row whose items exceed its width reports the excess", () => {
    const row = new PanelRow(ROW_WIDTH);
    row.leading(block(300));
    row.trailing(block(150));
    row.layout();

    assert.equal(row.overflow, 300 + 150 - ROW_WIDTH);
});

test("a fill squeezed to nothing claims no width or gaps", () => {
    const row = new PanelRow(ROW_WIDTH);
    row.leading(block(ROW_WIDTH));
    row.fill((width) => block(width));
    row.layout();

    assert.equal(row.overflow, 0);
});
