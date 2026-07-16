import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";
import {DemoMachineType, DEMO_INPUT_ITEM_TYPE, DEMO_OUTPUT_ITEM_TYPE} from "@/mods/Demo/declaration.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector} from "@/test/EventCollector.js";
import {beltsOf} from "@/mods/Logistics/testHelpers.js";

test("a machine placed via message adopts a belt, cooks its input, and deletes", async () => {
    const engine = await makeGameEngine();
    const collector = new EventCollector(engine);

    // Machine at (5,5); belt at (5,6) UP feeds its input edge (5,5).
    assert.equal(engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, 5, 5, Direction.UP)), true);
    const insert = collector.drain().find(event => event instanceof ObjectInsertEvent);
    assert.ok(insert, "ObjectInsertEvent emitted");
    assert.equal(insert.typeId, DemoMachineType.typeId);

    const belt = beltsOf(engine).placeBelt(5, 6, Direction.UP);
    // Feed the machine's recipe input; it should produce the cooked output.
    engine.setPortItem(belt.inPort, DEMO_INPUT_ITEM_TYPE);
    const outPort = engine.portAt(5, 4, Direction.UP);
    let cooked = false;
    for (let i = 0; i < 16 && !cooked; i += 1) {
        engine.tickAll();
        cooked = engine.portItem(outPort) === DEMO_OUTPUT_ITEM_TYPE;
    }
    assert.ok(cooked, "the belt-fed input was cooked to the machine's output");

    assert.equal(engine.applyMessage(new DeleteObjectMessage(insert.id)), true, "machine delete handled");
    assert.ok(collector.drain().some(event => event instanceof ObjectDeleteEvent && event.id === insert.id));
});
