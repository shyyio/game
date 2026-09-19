import {AbstractScenario} from "@/test/scenarios/AbstractScenario.js";
import {positiveIntParam} from "@/test/scenarios/scenarioParam.js";
import {buildLine, lineOrigin} from "@/test/productionLine.js";

// Lines are stamped at boot, so the default stays small enough to build in a frame or two;
// bench:lines counts belong to the snapshot path.
const DEFAULT_LINE_COUNT = 200;
const LINE_COUNT_PARAM = "lines";

/**
 * The bench:lines world: N extractor/belt/machine lines tiled on a grid, in the layout the tick
 * benchmark and the save writer share.
 */
export class ProductionLineScenario extends AbstractScenario {

    /**
     * @returns {string}
     */
    get name() {
        return "lines";
    }

    /**
     * @param {Game} game
     * @param {URLSearchParams} params
     * @returns {Promise<void>}
     */
    async apply(game, params) {
        const lineCount = positiveIntParam(params.get(LINE_COUNT_PARAM), DEFAULT_LINE_COUNT);
        for (let k = 0; k < lineCount; k += 1) {
            const origin = lineOrigin(k);
            buildLine(game.simEngine, origin.x, origin.y);
        }
    }
}
