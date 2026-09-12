import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {ecsModRegistry, makeGame} from "@/test/ecsSim.js";
import {StimpackScenario} from "@/test/scenarios/StimpackScenario.js";
import {buildStimpackFactory} from "@/test/stimpackLine.js";
import {
    ExtractorType,
    WaterResourceType,
    GraveyardResourceType,
    OxideDepositResourceType,
    CoalDepositResourceType,
    QuartzDepositResourceType,
    GreenhouseType,
    BlenderType,
    SpawningPoolType,
    TormentChamberType,
    BrewType,
    BakeType,
    BlastFurnaceType,
    FormingMachineType,
    DelicateAssemblyType,
    FillType,
    AirFilterType,
} from "@/mods/base-game/common/objectTypes.js";
import {ITEM_TYPE_STIMPACK} from "@/mods/base-game/common/constants.js";
import {TradingTerminalType} from "@/mods/market/common/objectTypes.js";
import {CHUNK_SIZE} from "@/common/constants.js";

async function buildFactory() {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    const root = buildStimpackFactory(game.simEngine, game, 8, 8);
    return {game, root};
}

const COUNT_PER_FACTORY = [
    [FillType, 1],
    [DelicateAssemblyType, 1],
    [FormingMachineType, 1],
    [BlastFurnaceType, 1],
    [BakeType, 2],
    [AirFilterType, 1],
    [BrewType, 2],
    [TormentChamberType, 1],
    [SpawningPoolType, 1],
    [BlenderType, 1],
    [GreenhouseType, 2],
    [ExtractorType, 7],
    [TradingTerminalType, 2],
    [WaterResourceType, 3],
    [GraveyardResourceType, 1],
    [OxideDepositResourceType, 1],
    [CoalDepositResourceType, 1],
    [QuartzDepositResourceType, 1],
];

/**
 * @param {GameEngine} engine
 * @param {number} factories
 * @returns {void}
 */
function assertPlacedCounts(engine, factories) {
    for (const [type, perFactory] of COUNT_PER_FACTORY) {
        const expected = perFactory * factories;
        const actual = engine.placed.getEidsByTypeId(type.objectTypeId).length;
        assert.equal(actual, expected, `${type.name}: expected ${expected} placed, found ${actual} (a collision silently dropped a placement)`);
    }
}

test("the Stimpack factory places every object with no tile collisions", async () => {
    const {game} = await buildFactory();
    assertPlacedCounts(game.simEngine, 1);
});

test("the Stimpack factory actually produces a Stimpack when ticked", async () => {
    const {game, root} = await buildFactory();
    const engine = game.simEngine;
    const def = engine.components.getComponentByName("Machine");
    const row = def.getRowByEid(engine.placed.getEidsByTypeId(FillType.objectTypeId)[0]);
    const outputPort = def.store.outputPort[row];

    let produced = false;
    for (let i = 0; i < 2000 && !produced; i += 1) {
        game.runTick();
        produced = engine.ports.getItemByPortEid(outputPort) === ITEM_TYPE_STIMPACK;
    }
    assert.ok(produced, "a Stimpack came out of Fill within the tick budget");
});

test("every placed object stands inside the factory's own chunk", async () => {
    const {game} = await buildFactory();
    const engine = game.simEngine;
    const placed = engine.placed.objects;
    const position = engine.Position;
    for (let row = 0; row < placed.count; row += 1) {
        const eid = placed.eids[row];
        const x = position.x[eid];
        const y = position.y[eid];
        assert.equal(Math.floor(x / CHUNK_SIZE), 0, `object at (${x},${y}) left the factory's chunk`);
        assert.equal(Math.floor(y / CHUNK_SIZE), 0, `object at (${x},${y}) left the factory's chunk`);
    }
});

test("the scenario tiles n factories, each producing a Stimpack", async () => {
    const copies = 4;
    const game = await makeGame();
    await new StimpackScenario().apply(game, new URLSearchParams(`n=${copies}`));
    const engine = game.simEngine;
    const fillEids = engine.placed.getEidsByTypeId(FillType.objectTypeId);
    assert.equal(fillEids.length, copies, "one Fill per copy");
    assertPlacedCounts(engine, copies);

    const def = engine.components.getComponentByName("Machine");
    const outputPorts = fillEids.map(eid => def.store.outputPort[def.getRowByEid(eid)]);
    const produced = new Set();
    for (let i = 0; i < 2000 && produced.size < copies; i += 1) {
        game.runTick();
        for (const portEid of outputPorts) {
            if (engine.ports.getItemByPortEid(portEid) === ITEM_TYPE_STIMPACK) {
                produced.add(portEid);
            }
        }
    }
    assert.equal(produced.size, copies, "every copy produced a Stimpack within the tick budget");
});

test("four factories tile a single chunk", async () => {
    const copies = 4;
    const game = await makeGame();
    await new StimpackScenario().apply(game, new URLSearchParams(`n=${copies}`));
    const engine = game.simEngine;
    assertPlacedCounts(engine, copies);
    const placed = engine.placed.objects;
    const position = engine.Position;
    for (let row = 0; row < placed.count; row += 1) {
        const eid = placed.eids[row];
        const x = position.x[eid];
        const y = position.y[eid];
        assert.equal(Math.floor(x / CHUNK_SIZE), 0, `object at (${x},${y}) left the shared chunk`);
        assert.equal(Math.floor(y / CHUNK_SIZE), 0, `object at (${x},${y}) left the shared chunk`);
    }
});
