import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {EMPTY} from "@/sim/GameEngine.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {ObjectType, PortDefinition, RecipeDefinition, RecipeByproduct, PlacementRule} from "@/common/ObjectType.js";
import {MachineBehavior} from "@/sim/behaviors/MachineBehavior.js";

const ITEM_INPUT = 901;
const ITEM_OUTPUT = 902;
const ITEM_BYPRODUCT = 903;

/**
 * Builds a fixture 1-input machine with an always/never/sometimes byproduct chance, isolated per
 * test so one machine's craft-seq doesn't leak into another's.
 */
function fixtureMachineType(name, chance) {
    return new ObjectType({
        name,
        inputPorts: [new PortDefinition("in", {x: 0, y: 0, direction: Direction.UP})],
        outputPorts: [
            new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP}),
            new PortDefinition("byproduct", {x: 0, y: 1, direction: Direction.DOWN}),
        ],
        geometry: "1x1",
        textureName: "demo-machine/0",
        label: name,
        placement: new PlacementRule({replaceSameKind: true}),
        behavior: new MachineBehavior({
            processingTicks: 1,
            recipes: [new RecipeDefinition([ITEM_INPUT], ITEM_OUTPUT, new RecipeByproduct(ITEM_BYPRODUCT, chance))],
            fallback: 0,
        }),
    });
}

const AlwaysByproductType = fixtureMachineType("AlwaysByproduct", 1);
const NeverByproductType = fixtureMachineType("NeverByproduct", 0);

class ByproductFixtureDeclaration extends AbstractModDeclaration {

    get name() {
        return "ByproductFixture";
    }

    get objectTypes() {
        return [AlwaysByproductType, NeverByproductType];
    }
}

async function engineWithFixture() {
    return makeGameEngine([new ModPackage(new ByproductFixtureDeclaration())]);
}

test("a chance=1 byproduct lands in the second output port alongside the main output", async () => {
    const engine = await engineWithFixture();
    engine.applyMessage(new CreateObjectMessage(AlwaysByproductType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(AlwaysByproductType.typeId);
    const def = engine.component("Machine");
    const row = def.row(eid);
    const inPort = def.store.in0[row];
    const outPort = def.store.out[row];
    const byproductPort = def.store.out2[row];

    engine.setPortItem(inPort, ITEM_INPUT);
    let delivered = false;
    for (let i = 0; i < 8 && !delivered; i += 1) {
        engine.tickAll();
        delivered = engine.portItem(outPort) === ITEM_OUTPUT && engine.portItem(byproductPort) === ITEM_BYPRODUCT;
    }
    assert.ok(delivered, "both the main output and the byproduct landed");
});

test("a chance=0 recipe never produces a byproduct", async () => {
    const engine = await engineWithFixture();
    engine.applyMessage(new CreateObjectMessage(NeverByproductType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(NeverByproductType.typeId);
    const def = engine.component("Machine");
    const row = def.row(eid);
    const inPort = def.store.in0[row];
    const outPort = def.store.out[row];
    const byproductPort = def.store.out2[row];

    for (let craft = 0; craft < 10; craft += 1) {
        engine.setPortItem(inPort, ITEM_INPUT);
        let delivered = false;
        for (let i = 0; i < 8 && !delivered; i += 1) {
            engine.tickAll();
            delivered = engine.portItem(outPort) === ITEM_OUTPUT;
        }
        assert.ok(delivered, `craft ${craft}: main output delivered`);
        assert.equal(engine.portItem(byproductPort), EMPTY, `craft ${craft}: byproduct port stayed empty`);
        engine.setPortItem(outPort, EMPTY);
    }
});

test("a machine with no byproduct-configured recipe never touches the second port", async () => {
    const engine = await engineWithFixture();
    engine.applyMessage(new CreateObjectMessage(NeverByproductType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(NeverByproductType.typeId);
    const def = engine.component("Machine");
    const row = def.row(eid);
    assert.notEqual(def.store.out2[row], EMPTY, "the second port was still wired (declared on the object type)");
});
