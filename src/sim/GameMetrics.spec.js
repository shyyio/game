import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {NodeMetricsStore} from "@/server/NodeMetricsStore.js";
import {METRICS_ENTRY_TYPE_ITEM_PRODUCED} from "@/common/MetricsEntry.js";
import {ecsModRegistry} from "@/test/ecsSim.js";

const PLAYER_REF = 1;
const ITEM_TYPE = 5;
const TIER = 10;

test("an itemProduced notification records an ITEM_PRODUCED entry", async () => {
    const modRegistry = ecsModRegistry();
    const store = new NodeMetricsStore(":memory:");
    const game = new Game(modRegistry, new GameEngine(modRegistry), undefined, store);
    await game.init();

    game.simEngine.itemProduced.notify(PLAYER_REF, ITEM_TYPE, 1);
    await game.metrics.flush();

    const rows = await store.queryRollup(METRICS_ENTRY_TYPE_ITEM_PRODUCED, PLAYER_REF, 0, 100, TIER);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].category, ITEM_TYPE);
    assert.equal(rows[0].count, 1);
});
