import {AbstractScenario} from "@/test/scenarios/AbstractScenario.js";
import {buildLine, lineOrigin} from "@/test/productionLine.js";

// Lines are stamped at boot rather than loaded from a save, so the default stays small enough to
// build in a frame or two; bench:lines counts belong to the snapshot path.
const DEFAULT_LINE_COUNT = 200;
const LINE_COUNT_PARAM = "lines";

/**
 * Parses a positive integer query param, falling back when absent or unparsable.
 * @param {string|null} raw
 * @param {number} fallback
 * @returns {number}
 */
function intParam(raw, fallback) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
}

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
        const lineCount = intParam(params.get(LINE_COUNT_PARAM), DEFAULT_LINE_COUNT);
        for (let k = 0; k < lineCount; k += 1) {
            const origin = lineOrigin(k);
            buildLine(game.simEngine, origin.x, origin.y);
        }
    }
}
