import {AbstractScenario} from "@/test/scenarios/AbstractScenario.js";
import {buildStimpackFactory} from "@/test/stimpackLine.js";

const ORIGIN_X = 8;
const ORIGIN_Y = 8;

/**
 * The full production chain, physically placed and wired end to end: raw extraction through
 * Biotech/Industry to a working Stimpack assembly line.
 */
export class StimpackScenario extends AbstractScenario {

    /**
     * @returns {string}
     */
    get name() {
        return "stimpack";
    }

    /**
     * @param {Game} game
     * @param {URLSearchParams} params
     * @returns {Promise<void>}
     */
    async apply(game, params) {
        buildStimpackFactory(game.simEngine, game, ORIGIN_X, ORIGIN_Y);
    }
}
