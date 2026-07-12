import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {DemoMod, DemoMachineDefinition} from "@/mods/DemoMod/DemoMod.js";
import {EcsEngine} from "@/common/sim/EcsEngine.js";
import {BeltModule} from "@/mods/Logistics/BeltModule.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {makeEcsSimEngine} from "@/test/ecsSim.js";

test("a second surface belt cannot occupy the same tile, and delete frees it", async () => {
    const engine = new EcsEngine();
    await engine.init();
    const belts = new BeltModule(engine);

    assert.notEqual(belts.placeBelt(5, 5, Direction.UP), null, "first belt placed");
    assert.equal(belts.placeBelt(5, 5, Direction.RIGHT), null, "second surface belt on the tile is rejected");

    belts.removeBelt(5, 5, Direction.UP);
    assert.notEqual(belts.placeBelt(5, 5, Direction.RIGHT), null, "tile is free after delete");
});

test("an object cannot be placed on an occupied tile", async () => {
    const mr = new ModRegistry();
    mr.loadMod(new LogisticsMod());
    mr.loadMod(new DemoMod());
    mr.definitions;
    const engine = await makeEcsSimEngine();

    engine.applyMessage(new CreateObjectMessage(DemoMachineDefinition.typeId, 5, 5, Direction.UP));
    assert.equal(engine.machine.ids.length, 1);
    engine.applyMessage(new CreateObjectMessage(DemoMachineDefinition.typeId, 5, 5, Direction.UP));
    assert.equal(engine.machine.ids.length, 1, "overlapping machine rejected");
});
