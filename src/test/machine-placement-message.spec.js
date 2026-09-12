import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";
import {ModPackage} from "@/common/ModPackage.js";
import {
    TestMachineType,
    ITEM_TYPE_TEST_MACHINE_INPUT,
    ITEM_TYPE_TEST_MACHINE_OUTPUT,
    MachineFixtureDeclaration,
} from "@/test/machineFixture.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector} from "@/test/EventCollector.js";
import {placeBelt, beltLaneAt} from "@/test/beltFixture.js";

test("a machine placed via message adopts a belt, cooks its input, and deletes", async () => {
    const engine = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    const collector = new EventCollector(engine);

    // Machine at (5,5); belt at (5,6) UP parents its input edge (5,5).
    assert.equal(engine.applyMessage(new CreateObjectMessage(TestMachineType.objectTypeId, 5, 5, Direction.UP)), true);
    const insert = collector.drain().find(event => event instanceof ObjectInsertEvent);
    assert.ok(insert, "ObjectInsertEvent emitted");
    assert.equal(insert.objectTypeId, TestMachineType.objectTypeId);

    placeBelt(engine, 5, 6, Direction.UP);
    const belt = beltLaneAt(engine, 5, 6);
    // Fill the machine's recipe input; it should produce the cooked output.
    engine.ports.setItem(belt.inputPort, ITEM_TYPE_TEST_MACHINE_INPUT);
    const outputPort = engine.ports.getPortEidAt(5, 4, Direction.UP);
    let cooked = false;
    for (let i = 0; i < 16 && !cooked; i += 1) {
        engine.tick();
        cooked = engine.ports.getItemByPortEid(outputPort) === ITEM_TYPE_TEST_MACHINE_OUTPUT;
    }
    assert.ok(cooked, "the belt-fed input was cooked to the machine's output");

    assert.equal(engine.applyMessage(new DeleteObjectMessage(insert.objectRef)), true, "machine delete handled");
    assert.ok(collector.drain().some(event => event instanceof ObjectDeleteEvent && event.objectRef === insert.objectRef));
});
