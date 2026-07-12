import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_NORMAL, BELT_RAMP_DOWN, BELT_RAMP_UP} from "@/mods/Logistics/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {BeltInsertEvent} from "@/mods/Logistics/events.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {makeEcsSimEngine} from "@/test/ecsSim.js";

const RED = 2;
const BLUE = 3;

test("a vertical tunnel and a horizontal belt cross on the same tile and flow independently", async () => {
    const engine = await makeEcsSimEngine();

    // Vertical UP tunnel down column x=0: ramp-down (0,4), ramp-up (0,1) -> undergrounds (0,3),(0,2); feeder (0,5).
    engine.applyMessage(new CreateBeltMessage(0, 4, Direction.UP, BELT_RAMP_DOWN));
    const rampDownId = engine.drainEvents().find(e => e instanceof BeltInsertEvent).id;
    engine.applyMessage(new CreateBeltMessage(0, 1, Direction.UP, BELT_RAMP_UP, rampDownId));
    engine.applyMessage(new CreateBeltMessage(0, 5, Direction.UP, BELT_NORMAL));

    // Horizontal RIGHT belt across row y=3, passing over the underground at (0,3).
    [-1, 0, 1, 2].forEach(x => engine.applyMessage(new CreateBeltMessage(x, 3, Direction.RIGHT, BELT_NORMAL)));

    // Tile (0,3) holds two belts on different axes.
    assert.equal(engine.belts._beltsAt(0, 3).length, 2, "underground + surface belt coexist on (0,3)");

    const tunnel = engine.belts.pathAt(0, 4);       // vertical (only belt at (0,4))
    const horizontal = engine.belts.pathAt(2, 3);   // horizontal (only belt at (2,3))
    assert.notEqual(tunnel.id, horizontal.id, "distinct paths");

    // Feed both; each output receives its own item, uncrossed.
    engine.engine.setPortItem(tunnel.inPort, RED);
    engine.engine.setPortItem(horizontal.inPort, BLUE);
    let tunnelOut = false;
    let horizOut = false;
    for (let i = 0; i < 20; i += 1) {
        engine.engine.setPortItem(tunnel.outPort, -1);
        engine.engine.setPortItem(horizontal.outPort, -1);
        engine.tickAll();
        if (engine.engine.portItem(tunnel.outPort) === RED) tunnelOut = true;
        if (engine.engine.portItem(horizontal.outPort) === BLUE) horizOut = true;
    }
    assert.ok(tunnelOut, "tunnel delivered its item");
    assert.ok(horizOut, "horizontal belt delivered its item");
});
