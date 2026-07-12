import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {BeltInsertEvent, BeltDeleteEvent} from "@/mods/Logistics/events.js";
import {DeleteObjectMessage} from "@/common/CoreMessages.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {makeEcsSimEngine} from "@/test/ecsSim.js";

const CELLS = [{x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}];

test("DeleteObjectMessage removes an ECS belt and emits a BeltDeleteEvent", async () => {
    const engine = await makeEcsSimEngine();
    CELLS.forEach(cell => engine.applyMessage(new CreateBeltMessage(cell.x, cell.y, Direction.UP, BELT_NORMAL)));

    const insert = engine.engine.drainEvents().find(event => event instanceof BeltInsertEvent && event.x === 0 && event.y === 1);
    assert.ok(insert, "belt (0,1) was placed");

    const removed = engine.applyMessage(new DeleteObjectMessage(insert.id));
    assert.equal(removed, true, "delete handled by the engine");

    const events = engine.engine.drainEvents();
    assert.ok(events.some(event => event instanceof BeltDeleteEvent && event.id === insert.id), "BeltDeleteEvent emitted");
    assert.equal(engine.belts.pathAt(0, 1), null, "the belt's tile is no longer on any path");
});
