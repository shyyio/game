import test from "node:test";
import assert from "node:assert/strict";
import {TILE_SIZE} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";
import {buildLanePath, buildLanePathEntry, LanePath} from "@/client/layers/LanePath.js";
import {LaneSlots} from "@/client/layers/LaneItemDrawLayer.js";

const HALF = TILE_SIZE / 2;

/**
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @returns {CacheEntry}
 */
function cell(tileX, tileY, direction) {
    return {tileX, tileY, data: {direction}};
}

/**
 * @param {Point} point
 * @param {number} x
 * @param {number} y
 * @param {string} message
 * @returns {void}
 */
function assertPoint(point, x, y, message) {
    assert.ok(Math.abs(point.x - x) < 0.001 && Math.abs(point.y - y) < 0.001,
        `${message}: expected (${x}, ${y}), got (${point.x}, ${point.y})`);
}

test("a straight cell runs a tile from edge midpoint to edge midpoint", () => {
    const entry = buildLanePathEntry(0, 0, Direction.UP, Direction.UP);
    assert.equal(entry.length, TILE_SIZE);
    assertPoint(entry.getPointByDistance(0), HALF, TILE_SIZE, "entry sits on the bottom edge");
    assertPoint(entry.getPointByDistance(HALF), HALF, HALF, "midpoint sits on the tile center");
    assertPoint(entry.getPointByDistance(TILE_SIZE), HALF, 0, "exit sits on the top edge");
});

test("a bend runs a quarter arc that misses the tile center", () => {
    // Travelling up into a cell facing left: in over the bottom edge, out over the left edge.
    const entry = buildLanePathEntry(0, 0, Direction.UP, Direction.LEFT);
    assert.ok(Math.abs(entry.length - HALF * Math.PI / 2) < 0.001, "a quarter turn at half-tile radius");
    assertPoint(entry.getPointByDistance(0), HALF, TILE_SIZE, "entry sits on the bottom edge");
    assertPoint(entry.getPointByDistance(entry.length), 0, HALF, "exit sits on the left edge");

    // The arc pivots on the bottom-left corner, so its midpoint bows away from the tile center.
    const middle = entry.getPointByDistance(entry.length / 2);
    const reach = HALF * Math.SQRT1_2;
    assertPoint(middle, reach, TILE_SIZE - reach, "arc midpoint bows toward the inside corner");
    assert.ok(Math.abs(middle.x - HALF) > 9 && Math.abs(middle.y - HALF) > 9,
        "the arc misses the tile center by the bow");
});

test("both turns out of a facing sweep a quarter circle in opposite directions", () => {
    const left = buildLanePathEntry(0, 0, Direction.UP, Direction.LEFT);
    const right = buildLanePathEntry(0, 0, Direction.UP, Direction.RIGHT);
    assert.ok(Math.abs(Math.abs(left.sweep) - Math.PI / 2) < 0.001, "left turn sweeps a quarter");
    assert.ok(Math.abs(Math.abs(right.sweep) - Math.PI / 2) < 0.001, "right turn sweeps a quarter");
    assert.ok(left.sweep * right.sweep < 0, "the two turns sweep opposite ways");
});

test("every bend leaves by the edge its facing names", () => {
    const turns = [
        [Direction.UP, Direction.LEFT, 0, HALF],
        [Direction.UP, Direction.RIGHT, TILE_SIZE, HALF],
        [Direction.DOWN, Direction.LEFT, 0, HALF],
        [Direction.DOWN, Direction.RIGHT, TILE_SIZE, HALF],
        [Direction.LEFT, Direction.UP, HALF, 0],
        [Direction.LEFT, Direction.DOWN, HALF, TILE_SIZE],
        [Direction.RIGHT, Direction.UP, HALF, 0],
        [Direction.RIGHT, Direction.DOWN, HALF, TILE_SIZE],
    ];
    for (const [incoming, direction, exitX, exitY] of turns) {
        const entry = buildLanePathEntry(0, 0, incoming, direction);
        const name = `${Direction.name(incoming)} -> ${Direction.name(direction)}`;
        assertPoint(entry.getPointByDistance(entry.length), exitX, exitY, name);
    }
});

test("a cell entered head-on throws", () => {
    assert.throws(() => buildLanePathEntry(3, 4, Direction.UP, Direction.DOWN), /entered head-on/);
});

test("a lane concatenates its cells and reports each one's start", () => {
    const path = buildLanePath(
        [cell(0, 2, Direction.UP), cell(0, 1, Direction.UP), cell(0, 0, Direction.UP)],
        [Direction.UP, Direction.UP, Direction.UP],
    );
    assert.equal(path.length, 3 * TILE_SIZE);
    assert.equal(path.getDistanceByCellIndex(0), 0);
    assert.equal(path.getDistanceByCellIndex(1), TILE_SIZE);
    assert.equal(path.getDistanceByCellIndex(3), 3 * TILE_SIZE, "the index past the last cell is the total");
    assert.equal(path.getLengthByCellIndex(1), TILE_SIZE);
});

test("a lane's points walk from its input edge to its output edge", () => {
    const path = buildLanePath(
        [cell(0, 1, Direction.UP), cell(0, 0, Direction.UP)],
        [Direction.UP, Direction.UP],
    );
    assertPoint(path.getPointByDistance(0), HALF, 2 * TILE_SIZE, "starts on the first cell's input edge");
    assertPoint(path.getPointByDistance(TILE_SIZE), HALF, TILE_SIZE, "the cell boundary is the shared edge");
    assertPoint(path.getPointByDistance(2 * TILE_SIZE), HALF, 0, "ends on the last cell's output edge");
});

test("a lane clamps a distance past either end onto its ends", () => {
    const path = buildLanePath([cell(0, 0, Direction.UP)], [Direction.UP]);
    assertPoint(path.getPointByDistance(-50), HALF, TILE_SIZE, "before the start");
    assertPoint(path.getPointByDistance(500), HALF, 0, "past the end");
});

test("a bend inside a lane keeps the run continuous at both its edges", () => {
    // Up the column, then a left turn, then on to the left.
    const path = buildLanePath(
        [cell(1, 1, Direction.UP), cell(1, 0, Direction.LEFT), cell(0, 0, Direction.LEFT)],
        [Direction.UP, Direction.UP, Direction.LEFT],
    );
    const bendStart = path.getDistanceByCellIndex(1);
    const bendEnd = path.getDistanceByCellIndex(2);
    assertPoint(path.getPointByDistance(bendStart), TILE_SIZE + HALF, TILE_SIZE, "enters over the shared edge");
    assertPoint(path.getPointByDistance(bendEnd), TILE_SIZE, HALF, "leaves over the shared edge");
});

test("an empty lane has no length", () => {
    assert.equal(new LanePath([]).length, 0);
});

test("a lane ends on the tail's output edge, where its output port rests its item", () => {
    // A column turning left at the tail: the port item sits on the left edge, not past the center.
    const path = buildLanePath(
        [cell(1, 1, Direction.UP), cell(1, 0, Direction.LEFT)],
        [Direction.UP, Direction.UP],
    );
    assertPoint(path.getPointByDistance(path.length), TILE_SIZE, HALF, "the tail's output edge");

    // The stretch names the facing, so the tile past the tail is reachable from the path alone.
    const tail = path.getEntryByCellIndex(1);
    assert.equal(tail.direction, Direction.LEFT);
    assert.equal(tail.tileX + Direction.dx(tail.direction), 0);
    assert.equal(tail.tileY + Direction.dy(tail.direction), 0);
});

test("the approach to a bent tail's output edge curves", () => {
    const path = buildLanePath(
        [cell(1, 1, Direction.UP), cell(1, 0, Direction.LEFT)],
        [Direction.UP, Direction.UP],
    );
    // Half a tile back along the path is where a popping item glides in from: on the arc, so it
    // shares neither axis with the resting spot a straight glide would have come down.
    const entering = path.getPointByDistance(path.length - TILE_SIZE / 2);
    const resting = path.getPointByDistance(path.length);
    assert.ok(entering.x !== resting.x && entering.y !== resting.y,
        `a bent tail is approached off both axes, got (${entering.x}, ${entering.y})`);
});

test("a slot's predecessor is the slot the sprite before it stood on", () => {
    // A column turning left at the tail, two slots per cell.
    const path = buildLanePath(
        [cell(1, 1, Direction.UP), cell(1, 0, Direction.LEFT)],
        [Direction.UP, Direction.UP],
    );
    const slots = new LaneSlots({cells: [0, 0], slots: [2, 2], offsets: [0, 2], total: 4, path});

    // The port rests at the path's end; the lane slot behind it is the bent tail's center, half
    // the arc back, not half a tile back.
    const tailCenter = slots.getDistanceBySlot(slots.total - 2);
    const arcHalf = path.getLengthByCellIndex(1) / 2;
    assert.ok(Math.abs((path.length - tailCenter) - arcHalf) < 0.001,
        `the port pops out of the tail center, ${path.length - tailCenter} back`);
    assert.ok(path.length - tailCenter < TILE_SIZE / 2,
        "a bend's step is shorter than a tile, so a fixed half-tile would start behind it");
});
