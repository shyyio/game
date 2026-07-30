import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {SetPlayerSettingMessage} from "@/common/PlayerMessages.js";
import {CursorMoveMessage, CursorHideMessage} from "./common/messages.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "./common/events.js";
import {CURSOR_SETTING_SHARE} from "./common/constants.js";
import {SETTING_OFF, CHUNK_SIZE} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";

async function gameWithSessions() {
    const modRegistry = ecsModRegistry();
    const game = new Game(modRegistry, new GameEngine(modRegistry));
    await game.init();
    const sender = new CapturingSession(1);
    const watcher = new CapturingSession(2);
    const bystander = new CapturingSession(3);
    game.connect(sender);
    game.connect(watcher);
    game.connect(bystander);
    game.dispatchMessage(new SetViewportMessage([chunkId(0, 0)]), sender);
    game.dispatchMessage(new SetViewportMessage([chunkId(0, 0)]), watcher);
    game.dispatchMessage(new SetViewportMessage([chunkId(1000, 1000)]), bystander);
    return {game, sender, watcher, bystander};
}

function cursorEvents(session) {
    return session.events.filter(event => event instanceof PlayerCursorEvent);
}

function hideEvents(session) {
    return session.events.filter(event => event instanceof PlayerCursorHideEvent);
}

test("a cursor move fans out to the sessions watching its chunk", async () => {
    const {game, sender, watcher, bystander} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);

    const seen = cursorEvents(watcher);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].playerId, 1);
    assert.equal(seen[0].x, 4.5);
    assert.equal(cursorEvents(bystander).length, 0, "a session watching another chunk gets nothing");
    assert.equal(cursorEvents(sender).length, 0, "no echo back to the owning session");
});

test("a share-off player's cursor moves are dropped", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, SETTING_OFF), sender);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 0);
});

test("a chunk crossing hides the cursor only for viewers losing sight of it", async () => {
    const {game, sender, watcher, bystander} = await gameWithSessions();
    // The watcher sees both chunks; a fourth session sees only the origin chunk.
    const edgeWatcher = new CapturingSession(4);
    game.connect(edgeWatcher);
    game.dispatchMessage(new SetViewportMessage([chunkId(0, 0)]), edgeWatcher);
    game.dispatchMessage(new SetViewportMessage([chunkId(0, 0), chunkId(CHUNK_SIZE, 0)]), watcher);

    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorMoveMessage(CHUNK_SIZE + 0.5, 7.25), sender);

    assert.equal(hideEvents(edgeWatcher).length, 1, "the origin-only viewer loses the cursor");
    assert.equal(hideEvents(edgeWatcher)[0].playerId, 1);
    assert.equal(hideEvents(watcher).length, 0, "a viewer of both chunks keeps it");
    assert.equal(cursorEvents(watcher).length, 2);
    assert.equal(hideEvents(bystander).length, 0);
});

test("a hide message erases the cursor for its last chunk's viewers alone", async () => {
    const {game, sender, watcher, bystander} = await gameWithSessions();
    game.dispatchMessage(new CursorHideMessage(), sender);
    assert.equal(hideEvents(watcher).length, 0, "never shown, nothing to hide");

    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorHideMessage(), sender);
    assert.equal(hideEvents(watcher).length, 1);
    assert.equal(hideEvents(watcher)[0].playerId, 1);
    assert.equal(hideEvents(bystander).length, 0);
});

test("a disconnect erases the cursor for the remaining viewers", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.disconnect(sender.id);
    assert.equal(hideEvents(watcher).length, 1);
    assert.equal(hideEvents(watcher)[0].playerId, 1);
    assert.equal(hideEvents(sender).length, 0, "the leaving session gets nothing");
});

test("a share-off setting write erases an already-shown cursor", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, SETTING_OFF), sender);
    assert.equal(hideEvents(watcher).length, 1);
});
