import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {PipeType} from "@/mods/fluids/common/objectTypes.js";
import {BlenderType} from "@/mods/base-game/common/objectTypes.js";
import {ITEM_TYPE_CABBAGE, ITEM_TYPE_NUTRIENT_SLOP} from "@/mods/base-game/common/constants.js";

test("a machine's delivered output notifies the engine's itemProduced listeners", async () => {
    const engine = await makeGameEngine();
    const produced = [];
    engine.itemProduced.add((playerRef, itemTypeId, amount) => produced.push([itemTypeId, amount]));
    engine.applyMessage(new CreateObjectMessage(BlenderType.objectTypeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 5, 4, Direction.UP));
    const [eid] = engine.placed.getEidsByTypeId(BlenderType.objectTypeId);
    const def = engine.components.getComponentByName("Machine");
    const row = def.getRowByEid(eid);

    for (let i = 0; i < 10; i += 1) {
        engine.ports.setItem(def.store.in0[row], ITEM_TYPE_CABBAGE);
        engine.tick();
    }

    assert.ok(produced.length > 0);
    assert.deepEqual(produced[0], [ITEM_TYPE_NUTRIENT_SLOP, 1]);
});
