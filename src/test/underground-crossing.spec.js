import {EMPTY} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {getLaneLevelLayer, LANE_LEVEL_BURIED} from "@/sim/LaneIndex.js";
import {BeltType, BeltTunnelDownType, BeltTunnelUpType} from "@/mods/logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {placeBelt, beltLaneAt} from "@/test/beltFixture.js";

const RED = 2;
const BLUE = 3;

test("a vertical tunnel and a horizontal belt cross on the same tile and flow independently", async () => {
    const engine = await makeGameEngine();

    // Vertical UP tunnel down column x=0: tunnel-down (0,4), tunnel-up (0,1) -> undergrounds (0,3),(0,2); feeder (0,5).
    placeBelt(engine, 0, 4, Direction.UP, BeltTunnelDownType);
    placeBelt(engine, 0, 1, Direction.UP, BeltTunnelUpType);
    placeBelt(engine, 0, 5, Direction.UP);

    // Horizontal RIGHT belt across row y=3, passing over the underground at (0,3).
    for (const x of [-1, 0, 1, 2]) {
        placeBelt(engine, x, 3, Direction.RIGHT);
    }

    // Tile (0,3) holds two belts on different layers.
    const buried = getLaneLevelLayer(LANE_LEVEL_BURIED, Direction.UP);
    const tunnel = beltLaneAt(engine, 0, 3, buried);
    const horizontal = beltLaneAt(engine, 0, 3, LAYER_SURFACE);
    assert.notEqual(tunnel.laneRef, horizontal.laneRef, "underground + surface belt coexist on (0,3) as distinct lanes");
    assert.equal(beltLaneAt(engine, 0, 5).laneRef, tunnel.laneRef);
    assert.equal(beltLaneAt(engine, 2, 3).laneRef, horizontal.laneRef);

    // Feed both; each output receives its own item, uncrossed.
    engine.ports.setItem(tunnel.inputPort, RED);
    engine.ports.setItem(horizontal.inputPort, BLUE);
    let tunnelOut = false;
    let horizOut = false;
    for (let i = 0; i < 20; i += 1) {
        engine.ports.setItem(tunnel.outputPort, EMPTY);
        engine.ports.setItem(horizontal.outputPort, EMPTY);
        engine.tick();
        if (engine.ports.getItemByPortEid(tunnel.outputPort) === RED) {
            tunnelOut = true;
        }
        if (engine.ports.getItemByPortEid(horizontal.outputPort) === BLUE) {
            horizOut = true;
        }
    }
    assert.ok(tunnelOut, "tunnel delivered its item");
    assert.ok(horizOut, "horizontal belt delivered its item");
});
