import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {EMPTY} from "@/sim/sentinels.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {ObjectType, PortDefinition, PlacementRule} from "@/common/ObjectType.js";
import {GeneratorBehavior} from "@/sim/behaviors/GeneratorBehavior.js";

const ITEM_MAIN = 910;
const ITEM_SECONDARY = 911;

const DualOutputGeneratorType = new ObjectType({
    name: "DualOutputGenerator",
    outputPorts: [
        new PortDefinition("outputPort", {x: 0, y: -1, direction: Direction.UP}),
        new PortDefinition("secondary", {x: 0, y: 1, direction: Direction.DOWN}),
    ],
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "DualOutputGenerator",
    placement: new PlacementRule({replaceSameKind: true}),
    behavior: new GeneratorBehavior({
        processingTicks: 1,
        output: ITEM_MAIN,
        secondaryOutput: {itemTypeId: ITEM_SECONDARY, processingTicks: 4},
    }),
});

const SingleOutputGeneratorType = new ObjectType({
    name: "SingleOutputGenerator",
    outputPorts: [new PortDefinition("outputPort", {x: 0, y: -1, direction: Direction.UP})],
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "SingleOutputGenerator",
    placement: new PlacementRule({replaceSameKind: true}),
    behavior: new GeneratorBehavior({processingTicks: 1, output: ITEM_MAIN}),
});

class GeneratorFixtureDeclaration extends AbstractModDeclaration {

    get name() {
        return "GeneratorFixture";
    }

    get objectTypes() {
        return [DualOutputGeneratorType, SingleOutputGeneratorType];
    }
}

async function engineWithFixture() {
    return makeGameEngine([new ModPackage(new GeneratorFixtureDeclaration())]);
}

test("a generator with no input port produces its main output on its own cadence", async () => {
    const engine = await engineWithFixture();
    engine.applyMessage(new CreateObjectMessage(SingleOutputGeneratorType.objectTypeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.getEidsByTypeId(SingleOutputGeneratorType.objectTypeId);
    const def = engine.components.getComponentByName("Generator");
    const outputPort = def.store.outputPort[def.getRowByEid(eid)];

    let produced = 0;
    for (let tick = 0; tick < 10; tick += 1) {
        engine.tick();
        if (engine.ports.getItemByPortEid(outputPort) === ITEM_MAIN) {
            produced += 1;
            engine.ports.setItem(outputPort, EMPTY);
        }
    }
    assert.ok(produced >= 5, `expected repeated production with no input at all, got ${produced} over 10 ticks`);
});

test("main and secondary outputs run independent cadences into their own ports", async () => {
    const engine = await engineWithFixture();
    engine.applyMessage(new CreateObjectMessage(DualOutputGeneratorType.objectTypeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.getEidsByTypeId(DualOutputGeneratorType.objectTypeId);
    const def = engine.components.getComponentByName("Generator");
    const row = def.getRowByEid(eid);
    const outputPort = def.store.outputPort[row];
    const secondaryPort = def.store.outputPort2[row];

    // Main is processingTicks=1 (fires nearly every tick); secondary is processingTicks=4 (rarer).
    let mainDelivered = 0;
    let secondaryDelivered = 0;
    for (let tick = 0; tick < 10; tick += 1) {
        engine.tick();
        if (engine.ports.getItemByPortEid(outputPort) === ITEM_MAIN) {
            mainDelivered += 1;
            engine.ports.setItem(outputPort, EMPTY);
        }
        if (engine.ports.getItemByPortEid(secondaryPort) === ITEM_SECONDARY) {
            secondaryDelivered += 1;
            engine.ports.setItem(secondaryPort, EMPTY);
        }
    }
    assert.ok(mainDelivered >= 5, `main should fire nearly every tick, got ${mainDelivered}/10`);
    assert.ok(secondaryDelivered >= 1 && secondaryDelivered < mainDelivered, "secondary is slower but still fires");
});

test("a generator with a single output port never wires or touches the second port", async () => {
    const engine = await engineWithFixture();
    engine.applyMessage(new CreateObjectMessage(SingleOutputGeneratorType.objectTypeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.getEidsByTypeId(SingleOutputGeneratorType.objectTypeId);
    const def = engine.components.getComponentByName("Generator");
    const row = def.getRowByEid(eid);
    assert.equal(def.store.outputPort2[row], EMPTY, "no second port was wired");
    engine.tick();
    engine.tick();
    assert.equal(def.store.outputPort2[row], EMPTY, "still untouched after ticking");
});
