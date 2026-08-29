import {BlankScenario} from "@/test/scenarios/BlankScenario.js";
import {LogicScenario} from "@/test/scenarios/LogicScenario.js";
import {ProductionLineScenario} from "@/test/scenarios/ProductionLineScenario.js";
import {StimpackScenario} from "@/test/scenarios/StimpackScenario.js";
import {ThroughputScenario} from "@/test/scenarios/ThroughputScenario.js";
import {SCENARIO_PARAM} from "@/test/scenarios/scenarioParam.js";

export {SCENARIO_PARAM};

const SCENARIOS = [
    new BlankScenario(),
    new LogicScenario(),
    new ProductionLineScenario(),
    new StimpackScenario(),
    new ThroughputScenario(),
];

const BY_NAME = new Map(SCENARIOS.map(scenario => [scenario.name, scenario]));

/**
 * The scenario named in the current URL, or null when none is.
 * @returns {{scenario: AbstractScenario, params: URLSearchParams}|null}
 * @private
 */
function selectedScenario() {
    const params = new URLSearchParams(window.location.search);
    const name = params.get(SCENARIO_PARAM);
    if (name === null) {
        return null;
    }
    const scenario = BY_NAME.get(name);
    if (scenario === undefined) {
        throw new Error(`Unknown scenario "${name}"; known scenarios: ${[...BY_NAME.keys()].join(", ")}`);
    }
    return {scenario, params};
}

/**
 * The mod packages the selected scenario brings of its own, appended to the loadout before it is
 * frozen so its object types get typeIds like any other mod's.
 * @returns {ModPackage[]}
 */
export function scenarioModPackages() {
    const selected = selectedScenario();
    if (selected === null) {
        return [];
    }
    return selected.scenario.modPackages();
}

/**
 * Applies the scenario named in the current URL, if any.
 * @param {Game} game
 * @returns {Promise<boolean>} whether a scenario ran
 */
export async function applyScenarioFromLocation(game) {
    const selected = selectedScenario();
    if (selected === null) {
        return false;
    }
    await selected.scenario.apply(game, selected.params);
    return true;
}
