import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {EMPTY} from "@/sim/GameEngine.js";
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
        new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP}),
        new PortDefinition("secondary", {x: 0, y: 1, direction: Direction.DOWN}),
    ],
    geometry: "1x1",
    textureName: "demo-machine/0",
    label: "DualOutputGenerator",
    placement: new PlacementRule({replaceSameKind: true}),
    behavior: new GeneratorBehavior({
        processingTicks: 1,
        output: ITEM_MAIN,
        secondaryOutput: {itemType: ITEM_SECONDARY, processingTicks: 4},
    }),
});

const SingleOutputGeneratorType = new ObjectType({
    name: "SingleOutputGenerator",
    outputPorts: [new PortDefinition("out", {x: 0, y: -1, direction: Direction.UP})],
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
    engine.applyMessage(new CreateObjectMessage(SingleOutputGeneratorType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(SingleOutputGeneratorType.typeId);
    const def = engine.component("Generator");
    const outPort = def.store.out[def.row(eid)];

    let produced = 0;
    for (let tick = 0; tick < 10; tick += 1) {
        engine.tickAll();
        if (engine.portItem(outPort) === ITEM_MAIN) {
            produced += 1;
            engine.setPortItem(outPort, EMPTY);
        }
    }
    assert.ok(produced >= 5, `expected repeated production with no input at all, got ${produced} over 10 ticks`);
});

test("main and secondary outputs run independent cadences into their own ports", async () => {
    const engine = await engineWithFixture();
    engine.applyMessage(new CreateObjectMessage(DualOutputGeneratorType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(DualOutputGeneratorType.typeId);
    const def = engine.component("Generator");
    const row = def.row(eid);
    const outPort = def.store.out[row];
    const secondaryPort = def.store.out2[row];

    // Main is processingTicks=1 (fires nearly every tick); secondary is processingTicks=4 (rarer).
    let mainDelivered = 0;
    let secondaryDelivered = 0;
    for (let tick = 0; tick < 10; tick += 1) {
        engine.tickAll();
        if (engine.portItem(outPort) === ITEM_MAIN) {
            mainDelivered += 1;
            engine.setPortItem(outPort, EMPTY);
        }
        if (engine.portItem(secondaryPort) === ITEM_SECONDARY) {
            secondaryDelivered += 1;
            engine.setPortItem(secondaryPort, EMPTY);
        }
    }
    assert.ok(mainDelivered >= 5, `main should fire nearly every tick, got ${mainDelivered}/10`);
    assert.ok(secondaryDelivered >= 1 && secondaryDelivered < mainDelivered, "secondary is slower but still fires");
});

test("a generator with a single output port never wires or touches the second port", async () => {
    const engine = await engineWithFixture();
    engine.applyMessage(new CreateObjectMessage(SingleOutputGeneratorType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(SingleOutputGeneratorType.typeId);
    const def = engine.component("Generator");
    const row = def.row(eid);
    assert.equal(def.store.out2[row], EMPTY, "no second port was wired");
    engine.tickAll();
    engine.tickAll();
    assert.equal(def.store.out2[row], EMPTY, "still untouched after ticking");
});
