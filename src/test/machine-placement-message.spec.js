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
import {beltsOf} from "@/mods/Logistics/sim/testHelpers.js";

test("a machine placed via message adopts a belt, cooks its input, and deletes", async () => {
    const engine = await makeGameEngine([new ModPackage(new MachineFixtureDeclaration())]);
    const collector = new EventCollector(engine);

    // Machine at (5,5); belt at (5,6) UP feeds its input edge (5,5).
    assert.equal(engine.applyMessage(new CreateObjectMessage(TestMachineType.typeId, 5, 5, Direction.UP)), true);
    const insert = collector.drain().find(event => event instanceof ObjectInsertEvent);
    assert.ok(insert, "ObjectInsertEvent emitted");
    assert.equal(insert.typeId, TestMachineType.typeId);

    const belt = beltsOf(engine).placeBelt(5, 6, Direction.UP);
    // Feed the machine's recipe input; it should produce the cooked output.
    engine.ports.setItem(belt.inPort, ITEM_TYPE_TEST_MACHINE_INPUT);
    const outPort = engine.ports.at(5, 4, Direction.UP);
    let cooked = false;
    for (let i = 0; i < 16 && !cooked; i += 1) {
        engine.tickAll();
        cooked = engine.ports.item(outPort) === ITEM_TYPE_TEST_MACHINE_OUTPUT;
    }
    assert.ok(cooked, "the belt-fed input was cooked to the machine's output");

    assert.equal(engine.applyMessage(new DeleteObjectMessage(insert.id)), true, "machine delete handled");
    assert.ok(collector.drain().some(event => event instanceof ObjectDeleteEvent && event.id === insert.id));
});
