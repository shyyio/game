import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL, BELT_RAMP_DOWN, BELT_RAMP_UP, BELT_UNDERGROUND} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {BeltInsertEvent} from "@/mods/Logistics/events.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {EventCollector} from "@/test/EventCollector.js";
import {beltsOf} from "@/mods/Logistics/testHelpers.js";

const RED = 1;

test("an item tunnels through a ramp-down / underground / ramp-up run", async () => {
    const engine = await makeGameEngine();
    const collector = new EventCollector(engine);

    // UP tunnel: ramp-down (0,4), ramp-up (0,1) fills undergrounds (0,3),(0,2); normal feeder (0,5).
    engine.applyMessage(new CreateBeltMessage(0, 4, Direction.UP, BELT_RAMP_DOWN));
    const rampDownId = collector.drain().find(e => e instanceof BeltInsertEvent).id;
    engine.applyMessage(new CreateBeltMessage(0, 1, Direction.UP, BELT_RAMP_UP, rampDownId));
    engine.applyMessage(new CreateBeltMessage(0, 5, Direction.UP, BELT_NORMAL));

    // Undergrounds were auto-created and the whole run is one path.
    assert.equal(beltsOf(engine).beltById(rampDownId).type, BELT_RAMP_DOWN);
    assert.equal(beltsOf(engine)._beltAt(0, 3, Direction.UP).type, BELT_UNDERGROUND, "underground filled at (0,3)");
    assert.equal(beltsOf(engine)._beltAt(0, 2, Direction.UP).type, BELT_UNDERGROUND, "underground filled at (0,2)");
    const path = beltsOf(engine).pathAt(0, 4);
    assert.ok(beltsOf(engine).pathAt(0, 5).id === path.id && beltsOf(engine).pathAt(0, 1).id === path.id, "the whole tunnel is one path");

    // An item injected at the top flows through the tunnel to the output.
    engine.setPortItem(path.inPort, RED);
    let arrived = false;
    for (let i = 0; i < 20 && !arrived; i += 1) {
        engine.setPortItem(path.outPort, -1);
        engine.tickAll();
        arrived = engine.portItem(path.outPort) === RED;
    }
    assert.ok(arrived, "the item tunneled through to the output");
});
