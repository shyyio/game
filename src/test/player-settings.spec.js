import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {SetPlayerSettingMessage} from "@/common/PlayerMessages.js";
import {PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {ModRegistry} from "@/common/ModRegistry.js";
import {ModPackage} from "@/common/ModPackage.js";
import {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
import {PlayerSettingEntry} from "@/common/PlayerSettingEntry.js";

const LOCKED_KEY = 900;
const WRITABLE_KEY = 901;

class SettingsDeclaration extends AbstractModDeclaration {

    get name() {
        return "Settings";
    }

    get playerSettingEntries() {
        return [
            new PlayerSettingEntry(LOCKED_KEY, false),
            new PlayerSettingEntry(WRITABLE_KEY, true),
        ];
    }
}

async function gameWithSessions() {
    const modRegistry = new ModRegistry();
    modRegistry.register(new ModPackage(new SettingsDeclaration()));
    modRegistry.freeze();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    const sender = new CapturingSession(1);
    const watcher = new CapturingSession(2);
    game.connect(sender);
    game.connect(watcher);
    return {game, sender, watcher};
}

function updateEvents(session) {
    return session.events.filter(event => event instanceof PlayerSettingsUpdateEvent);
}

test("client writes to unknown or non-client-writable keys are dropped", async () => {
    const {game, sender} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(999, 5), sender);
    game.dispatchMessage(new SetPlayerSettingMessage(LOCKED_KEY, 5), sender);

    assert.equal(game.playerSettings.get(1, 999), undefined);
    assert.equal(game.playerSettings.get(1, LOCKED_KEY), undefined);
    assert.equal(updateEvents(sender).length, 0);
});

test("a setting write updates the cache and echoes to the sender", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(WRITABLE_KEY, 5), sender);

    assert.equal(game.playerSettings.get(1, WRITABLE_KEY), 5);
    const echoes = updateEvents(sender);
    assert.equal(echoes.length, 1);
    assert.equal(echoes[0].key, WRITABLE_KEY);
    assert.equal(echoes[0].value, 5);
    assert.equal(updateEvents(watcher).length, 0, "another player's setting write never fans out");
});
