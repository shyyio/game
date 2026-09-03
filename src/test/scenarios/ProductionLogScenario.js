import {AbstractScenario} from "@/test/scenarios/AbstractScenario.js";

const PLAYER_COUNT = 30;
// The local session plays as player 1, so the seeded log is theirs.
const OWN_PLAYER_ID = 1;
const PRODUCED_CHANCE = 0.6;
const MAX_COUNT = 20000000;

/**
 * A random production log: thirty players, each having produced a random subset of the item
 * types in random amounts, so the log and leaderboard panels have something to show.
 */
export class ProductionLogScenario extends AbstractScenario {

    /**
     * @returns {string}
     */
    get name() {
        return "productionLog";
    }

    /**
     * @param {Game} game
     * @param {URLSearchParams} params
     * @returns {Promise<void>}
     */
    async apply(game, params) {
        const itemTypes = Array.from(game.modRegistry.items.entries()).map(entry => entry[0]);
        for (let playerId = OWN_PLAYER_ID; playerId < OWN_PLAYER_ID + PLAYER_COUNT; playerId += 1) {
            game.players.ensure(playerId);
            for (const itemType of itemTypes) {
                if (Math.random() > PRODUCED_CHANCE) {
                    continue;
                }
                game.simEngine.itemProduced.notify(playerId, itemType, 1 + Math.floor(Math.random() * MAX_COUNT));
            }
        }
    }
}
