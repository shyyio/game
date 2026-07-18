import {BlankScenario} from "@/test/scenarios/BlankScenario.js";
import {ProductionLineScenario} from "@/test/scenarios/ProductionLineScenario.js";

// Selects a scenario: ?scenario=lines&lines=200
const SCENARIO_PARAM = "scenario";

const SCENARIOS = [
    new BlankScenario(),
    new ProductionLineScenario(),
];

const BY_NAME = new Map(SCENARIOS.map(scenario => [scenario.name, scenario]));

/**
 * Applies the scenario named in the current URL, if any.
 * @param {Game} game
 * @returns {Promise<boolean>} whether a scenario ran
 */
export async function applyScenarioFromLocation(game) {
    const params = new URLSearchParams(window.location.search);
    const name = params.get(SCENARIO_PARAM);
    if (name === null) {
        return false;
    }
    const scenario = BY_NAME.get(name);
    if (scenario === undefined) {
        throw new Error(`Unknown scenario "${name}"; known scenarios: ${[...BY_NAME.keys()].join(", ")}`);
    }
    await scenario.apply(game, params);
    return true;
}
