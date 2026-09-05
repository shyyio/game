import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {BELT_TUNNEL_DOWN, BELT_UNDERGROUND} from "@/mods/logistics/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {BeltDefinition, BeltTunnelDownDefinition, BeltTunnelUpDefinition} from "@/mods/logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {beltsOf} from "@/mods/logistics/sim/testHelpers.js";

const RED = 1;

test("an item tunnels through a tunnel-down / underground / tunnel-up run", async () => {
    const engine = await makeGameEngine();

    // UP tunnel: tunnel-down (0,4), tunnel-up (0,1) fills undergrounds (0,3),(0,2); normal feeder (0,5).
    engine.applyMessage(new CreateObjectMessage(BeltTunnelDownDefinition.typeId, 0, 4, Direction.UP));
    const tunnelDownId = beltsOf(engine)._beltAt(0, 4, Direction.UP).id;
    engine.applyMessage(new CreateObjectMessage(BeltTunnelUpDefinition.typeId, 0, 1, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, 0, 5, Direction.UP));

    // Undergrounds were auto-created and the whole run is one path.
    assert.equal(beltsOf(engine).beltById(tunnelDownId).type, BELT_TUNNEL_DOWN);
    assert.equal(beltsOf(engine)._beltAt(0, 3, Direction.UP).type, BELT_UNDERGROUND, "underground filled at (0,3)");
    assert.equal(beltsOf(engine)._beltAt(0, 2, Direction.UP).type, BELT_UNDERGROUND, "underground filled at (0,2)");
    const path = beltsOf(engine).pathAt(0, 4);
    assert.ok(beltsOf(engine).pathAt(0, 5).id === path.id && beltsOf(engine).pathAt(0, 1).id === path.id, "the whole tunnel is one path");

    // An item injected at the top flows through the tunnel to the output.
    engine.ports.setItem(path.inPort, RED);
    let arrived = false;
    for (let i = 0; i < 20 && !arrived; i += 1) {
        engine.ports.setItem(path.outPort, -1);
        engine.tickAll();
        arrived = engine.ports.item(path.outPort) === RED;
    }
    assert.ok(arrived, "the item tunneled through to the output");
});
