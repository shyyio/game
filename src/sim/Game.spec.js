import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {GameSettingsKey} from "@/common/constants.js";

test("a new tick length is published to every connected session", async () => {
    const game = await makeGame();
    const session = new CapturingSession();
    game.connect(session);
    session.events.length = 0;

    game.setTickMs(250);

    assert.equal(game.gameSettings.get(GameSettingsKey.TICK_MS), 250);
    const update = session.events.find(event => event instanceof GameSettingsUpdateEvent);
    assert.deepEqual([update.key, update.value], [GameSettingsKey.TICK_MS, 250]);
});
