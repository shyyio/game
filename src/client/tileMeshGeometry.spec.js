import {test} from "node:test";
import assert from "node:assert";
import {TILE_SIZE} from "@/client/constants.js";
import {TileMeshColumns, VERTICES_PER_TILE, INDICES_PER_TILE, rotatedCorner, writeTile} from "@/client/tileMeshGeometry.js";

test("an unturned tile samples each frame corner at the matching quad corner", () => {
    for (let corner = 0; corner < VERTICES_PER_TILE; corner += 1) {
        assert.equal(rotatedCorner(corner, 0), corner);
    }
});

test("a quarter turn clockwise moves the frame's top-left corner to the quad's top-right", () => {
    // Quad corners run counter-clockwise from the top-left: 0 = top-left, 1 = top-right.
    assert.equal(rotatedCorner(1, 1), 0);
    assert.equal(rotatedCorner(0, 1), 3);
});

test("four quarter turns come back around", () => {
    for (let corner = 0; corner < VERTICES_PER_TILE; corner += 1) {
        assert.equal(rotatedCorner(corner, 4), corner);
    }
});

test("every turn permutes the corners without repeating one", () => {
    for (let turns = 0; turns < VERTICES_PER_TILE; turns += 1) {
        const seen = new Set();
        for (let corner = 0; corner < VERTICES_PER_TILE; corner += 1) {
            seen.add(rotatedCorner(corner, turns));
        }
        assert.equal(seen.size, VERTICES_PER_TILE, `turns=${turns} dropped a corner`);
    }
});

test("a tile's quad spans exactly its tile in world pixels", () => {
    const columns = new TileMeshColumns(1);
    writeTile(columns, 0, 3, 5, 0, 0);

    const xs = [];
    const ys = [];
    for (let vertex = 0; vertex < VERTICES_PER_TILE; vertex += 1) {
        xs.push(columns.positions[vertex * 2]);
        ys.push(columns.positions[vertex * 2 + 1]);
    }
    assert.equal(Math.min(...xs), 3 * TILE_SIZE);
    assert.equal(Math.max(...xs), 4 * TILE_SIZE);
    assert.equal(Math.min(...ys), 5 * TILE_SIZE);
    assert.equal(Math.max(...ys), 6 * TILE_SIZE);
});

test("a turned tile keeps its quad axis-aligned, turning only the uvs", () => {
    const straight = new TileMeshColumns(1);
    const turned = new TileMeshColumns(1);
    writeTile(straight, 0, 0, 0, 0, 0);
    writeTile(turned, 0, 0, 0, 1, 0);

    assert.deepEqual([...turned.positions], [...straight.positions]);
    assert.notDeepEqual([...turned.uvs], [...straight.uvs]);
});

test("uvs stay unit corners whatever the turn", () => {
    for (let turns = 0; turns < VERTICES_PER_TILE; turns += 1) {
        const columns = new TileMeshColumns(1);
        writeTile(columns, 0, 0, 0, turns, 0);
        for (const value of columns.uvs) {
            assert.ok(value === 0 || value === 1, `uv ${value} is not a unit corner`);
        }
    }
});

test("a tile's vertices all carry its sequence slot", () => {
    const columns = new TileMeshColumns(2);
    writeTile(columns, 0, 0, 0, 0, 7);
    writeTile(columns, 1, 1, 0, 0, 2);

    assert.deepEqual([...columns.sequences.slice(0, VERTICES_PER_TILE)], [7, 7, 7, 7]);
    assert.deepEqual([...columns.sequences.slice(VERTICES_PER_TILE)], [2, 2, 2, 2]);
});

test("each tile's triangles index only its own vertices", () => {
    const columns = new TileMeshColumns(3);
    for (let tile = 0; tile < 3; tile += 1) {
        writeTile(columns, tile, tile, 0, 0, 0);
    }
    for (let tile = 0; tile < 3; tile += 1) {
        const first = tile * VERTICES_PER_TILE;
        for (let at = tile * INDICES_PER_TILE; at < (tile + 1) * INDICES_PER_TILE; at += 1) {
            assert.ok(columns.indices[at] >= first && columns.indices[at] < first + VERTICES_PER_TILE);
        }
    }
});

test("both triangles of a quad wind the same way", () => {
    const columns = new TileMeshColumns(1);
    writeTile(columns, 0, 0, 0, 0, 0);

    const cross = (a, b, c) => {
        const ax = columns.positions[a * 2], ay = columns.positions[a * 2 + 1];
        const bx = columns.positions[b * 2], by = columns.positions[b * 2 + 1];
        const cx = columns.positions[c * 2], cy = columns.positions[c * 2 + 1];
        return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    };
    const first = cross(columns.indices[0], columns.indices[1], columns.indices[2]);
    const second = cross(columns.indices[3], columns.indices[4], columns.indices[5]);
    assert.ok(first !== 0 && second !== 0, "a triangle is degenerate");
    assert.equal(Math.sign(first), Math.sign(second));
});
