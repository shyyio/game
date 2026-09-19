// A look at item age: a tap pours fresh Raw Steel onto a packed belt and a sink drains the far end,
// so every tile shows steel one tick older than the tile behind it. The object types below are a
// scenario-local mod, injected into the loadout only when this scenario is selected.

import {
    AbstractModDeclaration,
    ModPackage,
    ObjectType,
    PortDefinition,
    PlacementRule,
    GeneratorBehavior,
    Direction,
} from "@/sdk/common.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {AbstractScenario} from "@/test/scenarios/AbstractScenario.js";
import {positiveIntParam} from "@/test/scenarios/scenarioParam.js";
import {ScenarioSinkType} from "@/test/scenarios/scenarioSink.js";
import {BeltType} from "@/mods/logistics/common/objectTypes.js";
import {ITEM_TYPE_RAW_STEEL} from "@/mods/base-game/common/constants.js";

const OUT = new PortDefinition("outputPort", {x: 0, y: -1, direction: Direction.UP});

export const SteelTapType = new ObjectType({
    name: "SteelTap",
    toolId: 95,
    outputPorts: [OUT],
    geometry: "1x1",
    textureName: "machine/1x1",
    label: "Steel Tap",
    inspectable: true,
    placement: new PlacementRule({shouldReplaceSameKind: true}),
    behavior: new GeneratorBehavior({processingTicks: 0, output: ITEM_TYPE_RAW_STEEL}),
});

export class SteelCoolingDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "SteelCooling";
    }

    get objectTypes() {
        return [SteelTapType, ScenarioSinkType];
    }
}

// The run's south end; the belt runs north from here, matching the north-flowing port convention.
const ORIGIN_X = 8;
const ORIGIN_Y = 24;

// Belt tiles between the tap and the sink. A belt holds two items per tile and steps one slot per
// tick, so the five-tick cooling plays out over the first few.
const DEFAULT_BELT_LENGTH = 12;
const BELT_LENGTH_PARAM = "belts";

// Long enough for the run to pack solid, so the whole gradient stands on the belt on arrival.
const WARMUP_TICKS = 60;

/**
 * Raw Steel cooling as it rides: a tap, a packed belt run north, and a sink draining the far end.
 */
export class SteelCoolingScenario extends AbstractScenario {

    /**
     * @returns {string}
     */
    get name() {
        return "steel";
    }

    /**
     * @returns {ModPackage[]}
     */
    modPackages() {
        return [new ModPackage(new SteelCoolingDeclaration())];
    }

    /**
     * @param {Game} game
     * @param {URLSearchParams} params
     * @returns {Promise<void>}
     */
    async apply(game, params) {
        const beltLength = positiveIntParam(params.get(BELT_LENGTH_PARAM), DEFAULT_BELT_LENGTH);
        const engine = game.simEngine;
        engine.applyMessage(new CreateObjectMessage(SteelTapType.objectTypeId, ORIGIN_X, ORIGIN_Y, Direction.UP));
        for (let step = 1; step <= beltLength; step += 1) {
            engine.applyMessage(new CreateObjectMessage(BeltType.objectTypeId, ORIGIN_X, ORIGIN_Y - step, Direction.UP));
        }
        engine.applyMessage(new CreateObjectMessage(
            ScenarioSinkType.objectTypeId,
            ORIGIN_X,
            ORIGIN_Y - beltLength - 1,
            Direction.UP,
        ));
        for (let tick = 0; tick < WARMUP_TICKS; tick += 1) {
            game.runTick();
        }
    }
}
