import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {ObjectInsertEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";
import {BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector} from "@/test/EventCollector.js";
import {beltsOf} from "@/mods/Logistics/sim/testHelpers.js";

const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];

test("DeleteObjectMessage removes an ECS belt and emits an ObjectDeleteEvent", async () => {
    const engine = await makeGameEngine();
    const collector = new EventCollector(engine);
    for (const cell of CELLS) {
        engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, cell.x, cell.y, Direction.UP));
    }

    const insert = collector.drain().find(event => event instanceof ObjectInsertEvent && event.x === 0 && event.y === 1);
    assert.ok(insert, "belt (0,1) was placed");

    const removed = engine.applyMessage(new DeleteObjectMessage(insert.id));
    assert.equal(removed, true, "delete handled by the engine");

    const events = collector.drain();
    assert.ok(events.some(event => event instanceof ObjectDeleteEvent && event.id === insert.id), "ObjectDeleteEvent emitted");
    assert.equal(beltsOf(engine).pathAt(0, 1), null, "the belt's tile is no longer on any path");
});
