import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {DemoMachineType} from "@/mods/Demo/declaration.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {Belts} from "@/mods/Logistics/Belts.js";
import {makeGameEngine} from "@/test/ecsSim.js";

test("a second surface belt cannot occupy the same tile, and delete frees it", async () => {
    const engine = new GameEngine();
    await engine.init();
    const belts = new Belts(engine);

    assert.notEqual(belts.placeBelt(5, 5, Direction.UP), null, "first belt placed");
    assert.equal(belts.placeBelt(5, 5, Direction.RIGHT), null, "second surface belt on the tile is rejected");

    belts.removeBelt(5, 5, Direction.UP);
    assert.notEqual(belts.placeBelt(5, 5, Direction.RIGHT), null, "tile is free after delete");
});

test("an object cannot be placed on an occupied tile", async () => {
    const engine = await makeGameEngine();

    engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP));
    assert.equal(engine.placed.eidsOf(DemoMachineType.typeId).length, 1);
    engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP));
    assert.equal(engine.placed.eidsOf(DemoMachineType.typeId).length, 1, "overlapping machine rejected");
});
