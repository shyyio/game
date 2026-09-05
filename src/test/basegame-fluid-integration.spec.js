import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {EMPTY} from "@/sim/sentinels.js";
import {makeGameEngine} from "@/test/ecsSim.js";
import {pipesOf} from "@/mods/fluids/sim/testHelpers.js";
import {PipeDefinition} from "@/mods/fluids/common/objectTypes.js";
import {
    BlenderType,
    AirFilterType,
    GreenhouseType,
    WaterResourceType,
    ExtractorType,
    BlastFurnaceType,
    BrewType,
} from "@/mods/base-game/common/objectTypes.js";
import {
    ITEM_TYPE_CABBAGE,
    ITEM_TYPE_NUTRIENT_SLOP,
    ITEM_TYPE_OXYGEN,
    ITEM_TYPE_WATER,
    ITEM_TYPE_CABBAGE_SEED,
    ITEM_TYPE_IRON_ORE,
    ITEM_TYPE_COKE,
    ITEM_TYPE_RAW_STEEL,
    ITEM_TYPE_ADRENOCHROME,
    ITEM_TYPE_MUSHROOM,
    ITEM_TYPE_BASIC_POTION_BASE,
    ITEM_TYPE_OVERLOAD_MIX,
} from "@/mods/base-game/common/constants.js";

test("a Blender pumps Nutrient Slop into an adjacent pipe network", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BlenderType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(BlenderType.typeId);
    const def = engine.components.get("Machine");
    const row = def.row(eid);
    engine.ports.setItem(def.store.in0[row], ITEM_TYPE_CABBAGE);
    engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, 5, 4, Direction.UP));
    const pipes = pipesOf(engine);

    for (let i = 0; i < 40; i += 1) {
        engine.tickAll();
        engine.ports.setItem(def.store.in0[row], ITEM_TYPE_CABBAGE);
    }

    const net = pipes.networkAt(5, 4);
    assert.equal(net.fluidType, ITEM_TYPE_NUTRIENT_SLOP, "the network adopted the Blender's fluid output");
    assert.ok(net.amount > 0, "some Nutrient Slop actually flowed in");
});

test("an Air Filter types its pipe network before any payload arrives", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(AirFilterType.typeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, 5, 4, Direction.UP));
    const pipes = pipesOf(engine);

    const net = pipes.networkAt(5, 4);
    assert.equal(net.fluidType, ITEM_TYPE_OXYGEN, "typed before any payload, from the Generator's declared source");
});

test("a pipe delivers Water into a Greenhouse's fluid input, completing the recipe", async () => {
    const engine = await makeGameEngine();
    // Greenhouse (3x3, facing UP) anchors at (5,5): its fluid input (east column, bottom row) sits
    // at tile (7,7) facing UP, fed from a pipe at (7,8) just south of it. Extractor south of that
    // pipe (its output lands on the pipe's own tile).
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.typeId, 7, 9, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, 7, 9, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(PipeDefinition.typeId, 7, 8, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(GreenhouseType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(GreenhouseType.typeId);
    const def = engine.components.get("Machine");
    const row = def.row(eid);
    const outPort = def.store.out[row];

    let produced = false;
    for (let i = 0; i < 200 && !produced; i += 1) {
        engine.ports.setItem(def.store.in0[row], ITEM_TYPE_CABBAGE_SEED);
        engine.tickAll();
        produced = engine.ports.item(outPort) !== EMPTY;
    }
    assert.ok(produced, "Water reached the Greenhouse through the pipe and the craft completed");
});

test("Blast Furnace produces Raw Steel from Iron Ore + Coke + Oxygen in one craft", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BlastFurnaceType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(BlastFurnaceType.typeId);
    const def = engine.components.get("Machine");
    const row = def.row(eid);

    let produced = false;
    for (let i = 0; i < 40 && !produced; i += 1) {
        engine.ports.setItem(def.store.in0[row], ITEM_TYPE_IRON_ORE);
        engine.ports.setItem(def.store.in1[row], ITEM_TYPE_COKE);
        engine.ports.setItem(def.store.in2[row], ITEM_TYPE_OXYGEN);
        engine.tickAll();
        produced = engine.ports.item(def.store.out[row]) === ITEM_TYPE_RAW_STEEL;
    }
    assert.ok(produced, "Blast Furnace produces Raw Steel from Iron Ore + Coke + Oxygen");
});

test("Brew produces both Basic Potion Base and Overload Mix, one machine", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(BrewType.typeId, 5, 5, Direction.UP));
    const [eid] = engine.placed.eidsOf(BrewType.typeId);
    const def = engine.components.get("Machine");
    const row = def.row(eid);
    const in0Port = def.store.in0[row];
    const in1Port = def.store.in1[row];
    const outPort = def.store.out[row];

    // Only feed a port once it's actually empty (gathered): feeding on every tick regardless would
    // let the machine pipeline-gather a second Mushroom+Water craft before this one's even read.
    let basicPotionBase = false;
    for (let i = 0; i < 40 && !basicPotionBase; i += 1) {
        if (engine.ports.item(in0Port) === EMPTY) {
            engine.ports.setItem(in0Port, ITEM_TYPE_MUSHROOM);
        }
        if (engine.ports.item(in1Port) === EMPTY) {
            engine.ports.setItem(in1Port, ITEM_TYPE_WATER);
        }
        engine.tickAll();
        basicPotionBase = engine.ports.item(outPort) === ITEM_TYPE_BASIC_POTION_BASE;
    }
    assert.ok(basicPotionBase, "Brew produces Basic Potion Base from Mushroom + Water");
    // The machine pipeline-gathers its NEXT craft's inputs on the same tick this one completes (once
    // remaining hits 0, gathering starts even before idle formally flips) — by the time we observe
    // completion, a second Mushroom+Water set is already sitting in slot0/slot1, queued. Clearing the
    // ports alone doesn't touch that internal state, so reset it directly for a truly blank machine.
    engine.ports.setItem(outPort, EMPTY);
    engine.ports.setItem(in0Port, EMPTY);
    engine.ports.setItem(in1Port, EMPTY);
    def.store.slot0[row] = EMPTY;
    def.store.slot1[row] = EMPTY;

    let overloadMix = false;
    for (let i = 0; i < 40 && !overloadMix; i += 1) {
        if (engine.ports.item(in0Port) === EMPTY) {
            engine.ports.setItem(in0Port, ITEM_TYPE_ADRENOCHROME);
        }
        if (engine.ports.item(in1Port) === EMPTY) {
            engine.ports.setItem(in1Port, ITEM_TYPE_BASIC_POTION_BASE);
        }
        engine.tickAll();
        overloadMix = engine.ports.item(outPort) === ITEM_TYPE_OVERLOAD_MIX;
    }
    assert.ok(overloadMix, "the same Brew also produces Overload Mix from Adrenochrome + Basic Potion Base");
});
