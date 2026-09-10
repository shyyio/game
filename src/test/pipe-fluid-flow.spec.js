import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {EMPTY} from "@/sim/sentinels.js";
import {makePipes} from "@/test/pipeFixture.js";
import {pipesOf} from "@/mods/fluids/sim/testHelpers.js";
import {FLUID_TYPE_WATER, FLUID_TYPE_OIL} from "@/mods/fluids/common/constants.js";
import {PipeType, TankType} from "@/mods/fluids/common/objectTypes.js";
import {WaterResourceType, ExtractorType, OxideDepositResourceType} from "@/mods/base-game/common/objectTypes.js";
import {ITEM_TYPE_WATER, ITEM_TYPE_IRON_ORE} from "@/mods/base-game/common/constants.js";
import {ModPackage} from "@/common/ModPackage.js";
import {
    TestVolcanoResourceType,
    TestDeepExtractorType,
    ITEM_TYPE_TEST_BRINE,
    VolcanoFixtureDeclaration,
} from "@/test/volcanoFixture.js";
import {BeltType} from "@/mods/logistics/common/objectTypes.js";
import {beltLaneAt, laneItemCount} from "@/test/beltFixture.js";
import {PortItemSetEvent} from "@/common/PortItemEvents.js";
import {ObjectFieldsEvent} from "@/common/ObjectEvents.js";
import {EventCollector} from "@/test/EventCollector.js";
import {makeGameEngine} from "@/test/ecsSim.js";

// Units in flight at the two ports of the y=63/64 seam (one payload = one unit).
function seamUnits(engine) {
    let units = 0;
    for (const port of [engine.ports.getPortEidAt(0, 64, Direction.DOWN), engine.ports.getPortEidAt(0, 63, Direction.UP)]) {
        if (engine.ports.getItemByPortEid(port) !== EMPTY) {
            units += 1;
        }
    }
    return units;
}

test("fluid crosses a chunk seam and equalizes between the networks", async () => {
    const {engine, pipes} = await makePipes();
    for (const y of [62, 63, 64, 65]) {
        pipes.placePipe(0, y);
    }
    pipes.addFluid(0, 62, FLUID_TYPE_WATER, 4);

    for (let i = 0; i < 30; i += 1) {
        engine.tick();
        const total = pipes.findNetworkAt(0, 62).amount + pipes.findNetworkAt(0, 64).amount + seamUnits(engine);
        assert.equal(total, 4, `tick ${i}: no fluid created or destroyed`);
    }

    const above = pipes.findNetworkAt(0, 62);
    const below = pipes.findNetworkAt(0, 64);
    assert.equal(above.amount, 2, "the seam settles at equal fill");
    assert.equal(below.amount, 2);
    assert.equal(below.fluidType, FLUID_TYPE_WATER, "the crossing payload carried its type");
    assert.equal(seamUnits(engine), 0, "nothing left in flight at rest");

    // Settled means settled: further ticks move nothing.
    for (let i = 0; i < 5; i += 1) {
        engine.tick();
    }
    assert.equal(pipes.findNetworkAt(0, 62).amount, 2);
    assert.equal(pipes.findNetworkAt(0, 64).amount, 2);
});

test("different fluids meeting at a seam block instead of mixing", async () => {
    const {engine, pipes} = await makePipes();
    for (const y of [62, 63, 64, 65]) {
        pipes.placePipe(0, y);
    }
    pipes.addFluid(0, 62, FLUID_TYPE_WATER, 4);
    pipes.addFluid(0, 64, FLUID_TYPE_OIL, 2);

    for (let i = 0; i < 10; i += 1) {
        engine.tick();
    }

    assert.equal(pipes.findNetworkAt(0, 62).amount, 4, "the water side holds");
    assert.equal(pipes.findNetworkAt(0, 62).fluidType, FLUID_TYPE_WATER);
    assert.equal(pipes.findNetworkAt(0, 64).amount, 2, "the oil side holds");
    assert.equal(pipes.findNetworkAt(0, 64).fluidType, FLUID_TYPE_OIL);
    assert.equal(seamUnits(engine), 0, "no payload enters the mismatched seam");
});

test("a pipe network drains into a tank through the shared edge port", async () => {
    const engine = await makeGameEngine();
    // The 2x2 tank at (0, 0) covers (0..1, 0..1) and is fed from (0, 2) through its bottom-left tile.
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 0, 2, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 0, 3, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TankType.objectTypeId, 0, 0, Direction.UP));
    const pipes = pipesOf(engine);
    pipes.addFluid(0, 2, FLUID_TYPE_WATER, 4);
    const collector = new EventCollector(engine);

    for (let i = 0; i < 20; i += 1) {
        engine.tick();
    }

    // Only the type change syncs: one delta when the tank adopts water, none for the fill.
    const tankDeltas = collector.drain().filter(event => event instanceof ObjectFieldsEvent);
    assert.equal(tankDeltas.length, 1, "amount changes emit nothing");
    assert.deepEqual(tankDeltas[0].values, [FLUID_TYPE_WATER]);

    const def = engine.components.getComponentByName("Tank");
    const row = def.getRowByEid(engine.placed.getEidsByTypeId(TankType.objectTypeId)[0]);
    const outputPort = engine.ports.getPortEidAt(1, -1, Direction.UP);
    assert.equal(pipes.findNetworkAt(0, 2).amount, 0, "the network drained fully");
    assert.equal(def.store.fluidType[row], FLUID_TYPE_WATER);
    // One payload rests in the tank's output port (its unconsumed output).
    assert.equal(engine.ports.getItemByPortEid(outputPort), FLUID_TYPE_WATER);
    assert.equal(def.store.amount[row] + 1, 4, "everything the network lost the tank (plus its output port) holds");
});

test("an extractor pumps its produce into an adjacent pipe network", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 0, 1, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 0, 1, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 0, 0, Direction.UP));
    const pipes = pipesOf(engine);

    for (let i = 0; i < 80; i += 1) {
        engine.tick();
    }

    const net = pipes.findNetworkAt(0, 0);
    assert.equal(net.fluidType, ITEM_TYPE_WATER, "the network adopts the produced number as its fluid");
    assert.equal(net.amount, net.capacity, "the extractor fills the network to capacity");
});

test("a resting fluid output never renders as a port item; a solid one does", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 0, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 0, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(OxideDepositResourceType.objectTypeId, 10, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 10, 5, Direction.UP));
    const collector = new EventCollector(engine);

    for (let i = 0; i < 10; i += 1) {
        engine.tick();
    }

    const sets = collector.drain().filter(event => event instanceof PortItemSetEvent);
    assert.ok(sets.some(event => event.itemTypeId === ITEM_TYPE_IRON_ORE), "the solid product renders");
    assert.ok(!sets.some(event => event.itemTypeId === ITEM_TYPE_WATER), "the fluid product does not");
});

test("a pipe adopting a fluid producer's output port binds its type at placement", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 0, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 0, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 0, 4, Direction.UP));
    const pipes = pipesOf(engine);

    const net = pipes.findNetworkAt(0, 4);
    assert.equal(net.fluidType, ITEM_TYPE_WATER, "typed before any payload");
    assert.equal(net.amount, 0);
});

test("a producer placed after the pipes types the empty network", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 0, 4, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 0, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 0, 5, Direction.UP));
    const pipes = pipesOf(engine);

    engine.tick();
    assert.equal(pipes.findNetworkAt(0, 4).fluidType, ITEM_TYPE_WATER, "the drained network re-binds to the producer");
});

test("a pipe cannot connect a producer's output port to a different fluid", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 0, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 0, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 1, 4, Direction.UP));
    const pipes = pipesOf(engine);
    pipes.addFluid(1, 4, FLUID_TYPE_OIL, 30);

    // (0, 4) touches both the oil network and the water extractor's output port.
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 0, 4, Direction.UP));
    assert.equal(pipes.findNetworkAt(0, 4), null, "the conflicting placement is rejected");
    assert.equal(pipes.pipeCount, 1);
});

test("a pipe binds brine from a deep extractor and cannot bridge to a water source", async () => {
    const engine = await makeGameEngine([new ModPackage(new VolcanoFixtureDeclaration())]);
    engine.applyMessage(new CreateObjectMessage(TestVolcanoResourceType.objectTypeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TestDeepExtractorType.objectTypeId, 6, 4, Direction.UP));
    const pipes = pipesOf(engine);

    // The deep extractor's output port edge is at (6, 3): the adopting pipe binds brine at placement.
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 6, 3, Direction.UP));
    assert.equal(pipes.findNetworkAt(6, 3).fluidType, ITEM_TYPE_TEST_BRINE, "typed before any payload");

    // A water extractor facing DOWN puts its output port edge at (5, 3); a pipe there would join the
    // brine network to a water source.
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 5, 2, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 5, 2, Direction.DOWN));
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 5, 3, Direction.UP));
    assert.equal(pipes.findNetworkAt(5, 3), null, "the conflicting placement is rejected");
    assert.equal(pipes.pipeCount, 1);
});

test("a belt refuses a fluid payload resting in its input port", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.objectTypeId, 0, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.objectTypeId, 0, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, 0, 4, Direction.UP));

    for (let i = 0; i < 20; i += 1) {
        engine.tick();
    }

    assert.equal(laneItemCount(engine), 0, "no fluid item ever boards the belt");
    // The refused payload rests in the shared edge port; the extractor is backed up behind it.
    assert.equal(engine.ports.getItemByPortEid(engine.ports.getPortEidAt(0, 4, Direction.UP)), ITEM_TYPE_WATER);
});

test("a belt never pops an item into a fluid port", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, 0, 1, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeType.objectTypeId, 0, 0, Direction.UP));
    const pipes = pipesOf(engine);
    const path = beltLaneAt(engine, 0, 1);
    engine.ports.setItem(path.inputPort, ITEM_TYPE_IRON_ORE);

    for (let i = 0; i < 20; i += 1) {
        engine.tick();
    }

    assert.equal(pipes.findNetworkAt(0, 0).amount, 0, "no solid item enters the network");
    assert.equal(engine.ports.getItemByPortEid(path.outputPort), EMPTY, "the shared edge port stays untouched");
    assert.equal(laneItemCount(engine), 1, "the item waits at the belt's end");
});
