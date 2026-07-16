import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {SplitterDefinition} from "@/mods/Logistics/objectTypes.js";
import {DemoMachineType, DEMO_INPUT_ITEM_TYPE, DEMO_OUTPUT_ITEM_TYPE} from "@/mods/Demo/declaration.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {beltsOf} from "@/mods/Logistics/testHelpers.js";

async function setup() {
    return makeGameEngine();
}

test("a RIGHT-facing machine adopts a RIGHT belt and cooks", async () => {
    const engine = await setup();
    // Belt (5,5) RIGHT feeds (6,5); machine at (6,5) facing RIGHT.
    engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, 6, 5, Direction.RIGHT));
    engine.applyMessage(new CreateBeltMessage(5, 5, Direction.RIGHT, BELT_NORMAL));
    const belt = beltsOf(engine).pathAt(5, 5);
    assert.equal(belt.outPort, engine.portAt(6, 5, Direction.RIGHT), "belt out adopted as machine input");

    engine.setPortItem(belt.inPort, DEMO_INPUT_ITEM_TYPE);
    const machineOut = engine.portAt(7, 5, Direction.RIGHT);
    let cooked = false;
    for (let i = 0; i < 16 && !cooked; i += 1) {
        engine.tickAll();
        cooked = engine.portItem(machineOut) === DEMO_OUTPUT_ITEM_TYPE;
    }
    assert.ok(cooked, "RIGHT machine cooked the belt-fed input");
});

test("a RIGHT-facing splitter adopts a RIGHT belt on its in_a", async () => {
    const engine = await setup();
    // Splitter at (6,5) facing RIGHT; in_a is its own tile edge. Belt (5,5) RIGHT feeds it.
    engine.applyMessage(new CreateObjectMessage(SplitterDefinition.typeId, 6, 5, Direction.RIGHT));
    engine.applyMessage(new CreateBeltMessage(5, 5, Direction.RIGHT, BELT_NORMAL));
    const belt = beltsOf(engine).pathAt(5, 5);
    assert.equal(belt.outPort, engine.portAt(6, 5, Direction.RIGHT), "belt out adopted as splitter in_a");

    engine.setPortItem(belt.inPort, 1);
    let arrived = false;
    // out_a for RIGHT splitter is one tile right of in_a tile.
    const outA = engine.portAt(7, 5, Direction.RIGHT);
    const outB = engine.portAt(7, 6, Direction.RIGHT);
    for (let i = 0; i < 10 && !arrived; i += 1) {
        engine.tickAll();
        arrived = engine.portItem(outA) === 1 || engine.portItem(outB) === 1;
    }
    assert.ok(arrived, "item flowed through the RIGHT splitter");
});
