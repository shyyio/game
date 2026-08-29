import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
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
} from "@/mods/BaseGame/common/objectTypes.js";
import {ITEM_TYPE_STIMPACK} from "@/mods/BaseGame/common/constants.js";
import {TradingTerminalType} from "@/mods/Market/common/objectTypes.js";

async function buildFactory() {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    const root = buildStimpackFactory(game.simEngine, game, 8, 8);
    return {game, root};
}

test("the Stimpack factory places every object with no tile collisions", async () => {
    const {game} = await buildFactory();
    const engine = game.simEngine;
    const counts = {
        [FillType.name]: [FillType, 1],
        [DelicateAssemblyType.name]: [DelicateAssemblyType, 1],
        [FormingMachineType.name]: [FormingMachineType, 1],
        [BlastFurnaceType.name]: [BlastFurnaceType, 1],
        [BakeType.name]: [BakeType, 2],
        [AirFilterType.name]: [AirFilterType, 1],
        [BrewType.name]: [BrewType, 2],
        [TormentChamberType.name]: [TormentChamberType, 1],
        [SpawningPoolType.name]: [SpawningPoolType, 1],
        [BlenderType.name]: [BlenderType, 1],
        [GreenhouseType.name]: [GreenhouseType, 2],
        [ExtractorType.name]: [ExtractorType, 7],
        [TradingTerminalType.name]: [TradingTerminalType, 2],
        [WaterResourceType.name]: [WaterResourceType, 3],
        [GraveyardResourceType.name]: [GraveyardResourceType, 1],
        [OxideDepositResourceType.name]: [OxideDepositResourceType, 1],
        [CoalDepositResourceType.name]: [CoalDepositResourceType, 1],
        [QuartzDepositResourceType.name]: [QuartzDepositResourceType, 1],
    };
    for (const [type, expected] of Object.values(counts)) {
        const actual = engine.placed.eidsOf(type.typeId).length;
        assert.equal(actual, expected, `${type.name}: expected ${expected} placed, found ${actual} (a collision silently dropped a placement)`);
    }
});

test("the Stimpack factory actually produces a Stimpack when ticked", async () => {
    const {game, root} = await buildFactory();
    const engine = game.simEngine;
    const def = engine.components.get("Machine");
    const row = def.row(engine.placed.eidsOf(FillType.typeId)[0]);
    const outPort = def.store.out[row];

    let produced = false;
    for (let i = 0; i < 2000 && !produced; i += 1) {
        game.runTick();
        produced = engine.ports.item(outPort) === ITEM_TYPE_STIMPACK;
    }
    assert.ok(produced, "a Stimpack came out of Fill within the tick budget");
});
