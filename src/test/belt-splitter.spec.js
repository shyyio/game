import {EMPTY} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {SplitterType} from "@/mods/logistics/common/objectTypes.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {placeBelt, beltLaneAt} from "@/test/beltFixture.js";

const RED = 1;

// A belt line parenting a splitter through the ordinary placement path; the splitter adopts the
// shared edge port as inputPortA and the item stream reaches its outputs.
test("a belt line parents a splitter through the shared edge port", async () => {
    const engine = await makeGameEngine();
    placeBelt(engine, 5, 7, Direction.UP);
    placeBelt(engine, 5, 6, Direction.UP);
    engine.applyMessage(new CreateObjectMessage(SplitterType.objectTypeId, 5, 5, Direction.UP));
    const parent = beltLaneAt(engine, 5, 7);
    const def = engine.components.getComponentByName("Splitter");
    const row = def.getRowByEid(def.eids[0]);
    assert.equal(def.store.inputPortA[row], parent.outputPort, "splitter inputPortA adopted the belt's output port");

    const outA = def.store.outputPortA[row];
    const outB = def.store.outputPortB[row];
    let delivered = 0;
    for (let i = 0; i < 16; i += 1) {
        engine.ports.setItem(parent.inputPort, RED);
        engine.ports.setItem(outA, EMPTY);
        engine.ports.setItem(outB, EMPTY);
        engine.tick();
        if (engine.ports.getItemByPortEid(outA) === RED || engine.ports.getItemByPortEid(outB) === RED) {
            delivered += 1;
        }
    }
    assert.ok(delivered > 0, "items flow through the splitter");
});
