import {EMPTY} from "@/sim/AbstractComponent.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
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
        inputPorts: [new PortDefinition("inputPort", {x: 0, y: 0, direction: Direction.UP})],
        outputPorts: [
            new PortDefinition("outputPort", {x: 0, y: -1, direction: Direction.UP}),
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
    engine.applyMessage(new CreateObjectMessage(AlwaysByproductType.objectTypeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.getEidsByTypeId(AlwaysByproductType.objectTypeId);
    const def = engine.components.getComponentByName("Machine");
    const row = def.getRowByEid(eid);
    const inputPort = def.store.inputPort0[row];
    const outputPort = def.store.outputPort[row];
    const byproductPort = def.store.outputPort2[row];

    engine.ports.setItem(inputPort, ITEM_INPUT);
    let delivered = false;
    for (let i = 0; i < 8 && !delivered; i += 1) {
        engine.tick();
        delivered = engine.ports.getItemByPortEid(outputPort) === ITEM_OUTPUT && engine.ports.getItemByPortEid(byproductPort) === ITEM_BYPRODUCT;
    }
    assert.ok(delivered, "both the main output and the byproduct landed");
});

test("a chance=0 recipe never produces a byproduct", async () => {
    const engine = await engineWithFixture();
    engine.applyMessage(new CreateObjectMessage(NeverByproductType.objectTypeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.getEidsByTypeId(NeverByproductType.objectTypeId);
    const def = engine.components.getComponentByName("Machine");
    const row = def.getRowByEid(eid);
    const inputPort = def.store.inputPort0[row];
    const outputPort = def.store.outputPort[row];
    const byproductPort = def.store.outputPort2[row];

    for (let craft = 0; craft < 10; craft += 1) {
        engine.ports.setItem(inputPort, ITEM_INPUT);
        let delivered = false;
        for (let i = 0; i < 8 && !delivered; i += 1) {
            engine.tick();
            delivered = engine.ports.getItemByPortEid(outputPort) === ITEM_OUTPUT;
        }
        assert.ok(delivered, `craft ${craft}: main output delivered`);
        assert.equal(engine.ports.getItemByPortEid(byproductPort), EMPTY, `craft ${craft}: byproduct port stayed empty`);
        engine.ports.setItem(outputPort, EMPTY);
    }
});

test("a machine with no byproduct-configured recipe never touches the second port", async () => {
    const engine = await engineWithFixture();
    engine.applyMessage(new CreateObjectMessage(NeverByproductType.objectTypeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.getEidsByTypeId(NeverByproductType.objectTypeId);
    const def = engine.components.getComponentByName("Machine");
    const row = def.getRowByEid(eid);
    assert.notEqual(def.store.outputPort2[row], EMPTY, "the second port was still wired (declared on the object type)");
});
