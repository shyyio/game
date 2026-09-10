import {test} from "node:test";
import assert from "node:assert/strict";
import {GameEngine} from "@/sim/GameEngine.js";
import {LAYER_SURFACE} from "@/common/constants.js";

test("An edge port shares a tile with a cell without occupying it", async () => {
    const engine = new GameEngine();
    await engine.init();
    const port = engine.ports.getPortEidAt(4, 7, 0);

    assert.equal(engine.space.isEveryCellFree([{x: 4, y: 7, layer: LAYER_SURFACE}]), true, "a port claims no cell");

    engine.space.occupy([{x: 4, y: 7, layer: LAYER_SURFACE}], 99);
    assert.equal(engine.space.isEveryCellFree([{x: 4, y: 7, layer: LAYER_SURFACE}]), false);
    assert.equal(engine.ports.getPortEidAt(4, 7, 0), port, "the shared edge port survives the cell");

    engine.space.destroyOwnerCells(99);
    assert.equal(engine.space.isEveryCellFree([{x: 4, y: 7, layer: LAYER_SURFACE}]), true);
    assert.equal(engine.ports.getPortEidAt(4, 7, 0), port, "releasing the cell leaves the port alone");
});
