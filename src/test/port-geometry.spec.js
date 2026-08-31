// The drift guard on the one rule two layers read: the sim resolves a shared edge port by eid, the
// client derives its connections by comparing edgeKeys, and both place a port with portAt. These
// hold the two identities to the same answer over the real loadout.

import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {portAt, edgeKey} from "@/common/portGeometry.js";
import {makeGameEngine} from "@/test/ecsSim.js";

const DIRECTIONS = [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT];
const PORT_KINDS = ["inputPorts", "outputPorts"];
// Placed away from the origin so a sign error in the rotation cannot pass by symmetry.
const ORIGIN_X = 37;
const ORIGIN_Y = -19;

test("every placed port round-trips through the sim's edge index", async () => {
    const engine = await makeGameEngine();
    const position = engine.space.Position;
    let checked = 0;

    for (const type of engine.modRegistry.objectTypes) {
        for (const direction of DIRECTIONS) {
            for (const portKind of PORT_KINDS) {
                for (const port of type.activePorts(portKind)) {
                    const placed = portAt(port, ORIGIN_X, ORIGIN_Y, direction);
                    const {port: eid, tile} = engine.portFor(port, ORIGIN_X, ORIGIN_Y, direction);

                    assert.deepEqual(tile, {x: placed.x, y: placed.y});
                    // The eid the index handed back must carry the position its key was built from.
                    assert.equal(position.x[eid], placed.x);
                    assert.equal(position.y[eid], placed.y);
                    assert.equal(position.direction[eid], placed.direction);
                    checked += 1;
                }
            }
        }
    }

    assert.ok(checked > 0, "the loadout declares no ports to check");
});

test("one edgeKey means one port eid", async () => {
    const engine = await makeGameEngine();
    const seen = new Map();

    for (const type of engine.modRegistry.objectTypes) {
        for (const direction of DIRECTIONS) {
            for (const portKind of PORT_KINDS) {
                for (const port of type.activePorts(portKind)) {
                    const placed = portAt(port, ORIGIN_X, ORIGIN_Y, direction);
                    const key = edgeKey(placed.x, placed.y, placed.direction);
                    const {port: eid} = engine.portFor(port, ORIGIN_X, ORIGIN_Y, direction);
                    const previous = seen.get(key);
                    if (previous === undefined) {
                        seen.set(key, eid);
                    } else {
                        assert.equal(eid, previous, `edgeKey ${key} resolved to two port eids`);
                    }
                }
            }
        }
    }
});

test("a producer and the consumer it reaches share one port", async () => {
    const engine = await makeGameEngine();
    // An out-port reaching cell C facing D and an in-port sitting on C facing D are the same edge,
    // which is what lets the client pair them off edgeKey alone.
    const out = {x: 0, y: -1, direction: Direction.UP};
    const emitter = portAt(out, ORIGIN_X, ORIGIN_Y, Direction.UP);
    const consumerTileY = ORIGIN_Y - 1;
    const inPort = {x: 0, y: 0, direction: Direction.UP};
    const receiver = portAt(inPort, ORIGIN_X, consumerTileY, Direction.UP);

    assert.equal(edgeKey(emitter.x, emitter.y, emitter.direction), edgeKey(receiver.x, receiver.y, receiver.direction));
    assert.equal(
        engine.portFor(out, ORIGIN_X, ORIGIN_Y, Direction.UP).port,
        engine.portFor(inPort, ORIGIN_X, consumerTileY, Direction.UP).port,
    );
});

test("rotating a placement rotates its ports", async () => {
    const engine = await makeGameEngine();
    const port = {x: 0, y: -1, direction: Direction.UP};
    const placements = DIRECTIONS.map(direction => portAt(port, 0, 0, direction));

    assert.deepEqual(placements, [
        {x: 0, y: -1, direction: Direction.UP},
        {x: 1, y: 0, direction: Direction.RIGHT},
        {x: 0, y: 1, direction: Direction.DOWN},
        {x: -1, y: 0, direction: Direction.LEFT},
    ]);
    // Four distinct edges, so no two rotations collide in the index.
    const eids = DIRECTIONS.map(direction => engine.portFor(port, 0, 0, direction).port);
    assert.equal(new Set(eids).size, DIRECTIONS.length);
});
