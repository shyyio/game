import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {Belts} from "@/mods/logistics/sim/Belts.js";

// portAt returns one shared port per edge, so an object's port and the adjacent belt's port coincide.
test("portAt shares one port per tile-edge", async () => {
    const engine = new GameEngine();
    await engine.init();
    const a = engine.ports.at(3, 4, Direction.UP);
    assert.equal(engine.ports.at(3, 4, Direction.UP), a, "same edge -> same port");
    assert.notEqual(engine.ports.at(3, 4, Direction.RIGHT), a, "different direction -> different port");
    assert.notEqual(engine.ports.at(3, 5, Direction.UP), a, "different tile -> different port");
});

test("a belt's in/out ports are the shared edge ports an object would adopt", async () => {
    const engine = new GameEngine();
    await engine.init();
    const belts = new Belts(engine);
    let handle = null;
    for (const cell of [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}]) {
        handle = belts.placeBelt(cell.x, cell.y, Direction.UP);
    }

    // Head = (0,2) (most upstream, UP); tail = (0,0), feeding (0,-1).
    assert.equal(handle.inPort, engine.ports.at(0, 2, Direction.UP), "in-port = head-tile edge");
    assert.equal(handle.outPort, engine.ports.at(0, -1, Direction.UP), "out-port = tail-downstream edge (an object at (0,-1) shares it)");
});
