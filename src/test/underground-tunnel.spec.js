import {EMPTY} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {getLaneLevelLayer, LANE_LEVEL_BURIED} from "@/sim/LaneIndex.js";
import {BeltType, BeltTunnelDownType, BeltTunnelUpType, BeltUndergroundType} from "@/mods/logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {placeBelt, beltLaneAt} from "@/test/beltFixture.js";

const RED = 1;

test("an item tunnels through a tunnel-down / underground / tunnel-up run", async () => {
    const engine = await makeGameEngine();

    // UP tunnel: tunnel-down (0,4), tunnel-up (0,1) fills undergrounds (0,3),(0,2); normal parent (0,5).
    placeBelt(engine, 0, 4, Direction.UP, BeltTunnelDownType);
    placeBelt(engine, 0, 1, Direction.UP, BeltTunnelUpType);
    placeBelt(engine, 0, 5, Direction.UP);

    // Undergrounds were auto-created and the whole run is one lane.
    const buried = getLaneLevelLayer(LANE_LEVEL_BURIED, Direction.UP);
    for (const y of [3, 2]) {
        const eid = engine.placed.getEidAt(0, y, buried);
        assert.equal(engine.placed.getObjectTypeIdByEid(eid), BeltUndergroundType.objectTypeId, `underground filled at (0,${y})`);
    }
    const lane = beltLaneAt(engine, 0, 5);
    assert.equal(beltLaneAt(engine, 0, 4).laneRef, lane.laneRef);
    assert.equal(beltLaneAt(engine, 0, 3, buried).laneRef, lane.laneRef);
    assert.equal(beltLaneAt(engine, 0, 1).laneRef, lane.laneRef, "the whole tunnel is one lane");

    // An item injected at the top flows through the tunnel to the output.
    engine.ports.setItem(lane.inputPort, RED);
    let arrived = false;
    for (let i = 0; i < 20 && !arrived; i += 1) {
        engine.ports.setItem(lane.outputPort, EMPTY);
        engine.tick();
        arrived = engine.ports.getItemByPortEid(lane.outputPort) === RED;
    }
    assert.ok(arrived, "the item tunneled through to the output");
});
