import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGame} from "@/test/ecsSim.js";
import {ThroughputScenario, sinkConsumedTotal} from "@/test/scenarios/ThroughputScenario.js";

// Ticks measured after the scenario's own warmup, long enough that a one-off startup item can't
// move the rate much.
const MEASURE_TICKS = 200;

/**
 * @param {number} beltLength
 * @returns {Promise<{game: Game, scenario: ThroughputScenario}>}
 */
async function runVariant(beltLength) {
    const scenario = new ThroughputScenario();
    const game = await makeGame(scenario.modPackages());
    await scenario.apply(game, new URLSearchParams(`belts=${beltLength}`));
    return {game, scenario};
}

/**
 * @param {Game} game
 * @returns {number} items the sink drained over MEASURE_TICKS
 */
function measure(game) {
    const before = sinkConsumedTotal(game.simEngine);
    for (let tick = 0; tick < MEASURE_TICKS; tick += 1) {
        game.runTick();
    }
    return sinkConsumedTotal(game.simEngine) - before;
}

test("the belted chain delivers at full throughput", async () => {
    const {game} = await runVariant(4);
    assert.ok(sinkConsumedTotal(game.simEngine) > 0, "nothing reached the sink during warmup");
    assert.equal(measure(game), MEASURE_TICKS, "one item per tick");
});

test("the belt-less chain delivers at full throughput", async () => {
    const {game} = await runVariant(0);
    assert.ok(sinkConsumedTotal(game.simEngine) > 0, "nothing reached the sink during warmup");
    assert.equal(measure(game), MEASURE_TICKS, "one item per tick");
});
