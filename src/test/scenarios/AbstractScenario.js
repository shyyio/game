import {NotImplementedError} from "@/common/error.js";

/**
 * A dev-only world preset, applied to a freshly inited engine before any session connects so the
 * objects reach the client through the normal chunk sync.
 * @abstract
 */
export class AbstractScenario {

    /**
     * The name selecting this scenario in the URL.
     * @abstract
     * @returns {string}
     */
    get name() {
        throw new NotImplementedError();
    }

    /**
     * The scenario-local mod packages to append to the loadout before it is frozen; empty for a
     * scenario built purely from the loadout's own object types.
     * @returns {ModPackage[]}
     */
    modPackages() {
        return [];
    }

    /**
     * Populates the world.
     * @abstract
     * @param {Game} game
     * @param {URLSearchParams} params - the query string, for scenario-specific tuning
     * @returns {Promise<void>}
     */
    async apply(game, params) {
        throw new NotImplementedError();
    }
}
