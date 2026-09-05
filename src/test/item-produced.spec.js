import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {PipeDefinition} from "@/mods/fluids/common/objectTypes.js";
import {BlenderType} from "@/mods/base-game/common/objectTypes.js";
import {ITEM_TYPE_CABBAGE, ITEM_TYPE_NUTRIENT_SLOP} from "@/mods/base-game/common/constants.js";

test("a machine's delivered output notifies the engine's itemProduced listeners", async () => {
    const engine = await makeGameEngine();
    const produced = [];
    engine.itemProduced.add((playerId, itemType, amount) => produced.push([itemType, amount]));
    engine.applyMessage(new CreateObjectMessage(BlenderType.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, 5, 4, Direction.UP));
    const [eid] = engine.placed.eidsOf(BlenderType.typeId);
    const def = engine.components.get("Machine");
    const row = def.row(eid);

    for (let i = 0; i < 10; i += 1) {
        engine.ports.setItem(def.store.in0[row], ITEM_TYPE_CABBAGE);
        engine.tickAll();
    }

    assert.ok(produced.length > 0);
    assert.deepEqual(produced[0], [ITEM_TYPE_NUTRIENT_SLOP, 1]);
});
