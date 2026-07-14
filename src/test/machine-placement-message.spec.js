import {test} from "node:test";
import assert from "node:assert/strict";
import {ModRegistry} from "@/common/ModRegistry.js";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {EasyObjectInsertEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";
import {LogisticsMod} from "@/mods/Logistics/mod.js";
import {DemoMod, DemoMachineDefinition, DEMO_INPUT_ITEM_TYPE, DEMO_OUTPUT_ITEM_TYPE} from "@/mods/DemoMod/DemoMod.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {makeGameEngine} from "@/test/ecsSim.js";

test("a machine placed via message adopts a belt, cooks its input, and deletes", async () => {
    const modRegistry = new ModRegistry();
    modRegistry.loadMod(new LogisticsMod());
    modRegistry.loadMod(new DemoMod());
    modRegistry.definitions; // assign typeIds

    const engine = await makeGameEngine();

    // Machine at (5,5); belt at (5,6) UP feeds its input edge (5,5).
    assert.equal(engine.applyMessage(new CreateObjectMessage(DemoMachineDefinition.typeId, 5, 5, Direction.UP)), true);
    const insert = engine.drainEvents().find(event => event instanceof EasyObjectInsertEvent);
    assert.ok(insert, "EasyObjectInsertEvent emitted");
    assert.equal(insert.typeId, DemoMachineDefinition.typeId);

    const belt = engine.belts.placeBelt(5, 6, Direction.UP);
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
    assert.ok(engine.drainEvents().some(event => event instanceof EasyObjectDeleteEvent && event.id === insert.id));
});
