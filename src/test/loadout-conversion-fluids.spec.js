// A loadout change empties the item-typed columns; the amount beside them is not an item type, so it
// survives. Each module that pairs the two puts the pair back in step as it rebuilds.

import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {EMPTY} from "@/sim/sentinels.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {pipesOf} from "@/mods/fluids/sim/testHelpers.js";
import {FLUID_TYPE_WATER} from "@/mods/fluids/common/constants.js";
import {PipeType, TankType} from "@/mods/fluids/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";

/**
 * A tank fed from a pipe, both holding water.
 * @returns {Promise<GameEngine>}
 */
async function filled() {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 0, 2, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 0, 3, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TankType.objectTypeId, 0, 0, Direction.UP));
    pipesOf(engine).addFluid(0, 2, FLUID_TYPE_WATER, 8);
    for (let tick = 0; tick < 4; tick += 1) {
        engine.tick();
    }
    pipesOf(engine).addFluid(0, 2, FLUID_TYPE_WATER, 4);
    return engine;
}

/**
 * The snapshot with every "item" column emptied, as a loadout that drops the fluid leaves it.
 * @param {GameEngine} engine
 * @returns {object}
 */
function withFluidLost(engine) {
    const snapshot = JSON.parse(JSON.stringify(engine.snapshots.serialize()));
    for (const component of snapshot.components) {
        for (const field of component.fields) {
            if (field.kind !== "item") {
                continue;
            }
            for (const row of component.rows) {
                row[field.name] = EMPTY;
            }
        }
    }
    return snapshot;
}

test("a tank whose fluid the loadout dropped comes back empty, not holding untyped units", async () => {
    const engine = await filled();
    const def = engine.components.getComponentByName("Tank");
    assert.ok(def.store.amount[def.getRowByEid(engine.placed.getEidsByTypeId(TankType.objectTypeId)[0])] > 0);

    const restored = await makeGameEngine();
    restored.snapshots.deserialize(withFluidLost(engine));
    const restoredDef = restored.components.getComponentByName("Tank");
    const row = restoredDef.getRowByEid(restored.placed.getEidsByTypeId(TankType.objectTypeId)[0]);
    assert.deepEqual(
        [restoredDef.store.fluidType[row], restoredDef.store.amount[row]],
        [EMPTY, 0],
    );
});

test("a pipe network whose fluid the loadout dropped comes back empty", async () => {
    const engine = await filled();
    assert.ok(pipesOf(engine).getNetworkAtOrNull(0, 2).amount > 0);

    const restored = await makeGameEngine();
    restored.snapshots.deserialize(withFluidLost(engine));
    const net = pipesOf(restored).getNetworkAtOrNull(0, 2);
    assert.deepEqual([net.fluidType, net.amount], [EMPTY, 0]);
});
