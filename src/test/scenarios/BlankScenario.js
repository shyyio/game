import {AbstractScenario} from "@/test/scenarios/AbstractScenario.js";

/**
 * The empty world, matching a boot with no scenario selected.
 */
export class BlankScenario extends AbstractScenario {

    /**
     * @returns {string}
     */
    get name() {
        return "blank";
    }

    /**
     * @param {Game} game
     * @param {URLSearchParams} params
     * @returns {Promise<void>}
     */
    async apply(game, params) {
    }
}
