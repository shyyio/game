import {test} from "node:test";
import assert from "node:assert/strict";
import {Game} from "@/sim/Game.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {SetPlayerSettingMessage, AddFriendMessage, RemoveFriendMessage} from "@/common/PlayerMessages.js";
import {CursorMoveMessage, CursorHideMessage} from "./common/messages.js";
import {PlayerCursorEvent, PlayerCursorHideEvent} from "./common/events.js";
import {CURSOR_SETTING_SHARE, CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_NONE, CURSOR_AUDIENCE_FRIENDS} from "./common/constants.js";
import {CHUNK_SIZE} from "@/common/constants.js";
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

test("a non-sharing player's cursor moves are dropped", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_NONE), sender);
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

test("a share-stopping setting write erases an already-shown cursor", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_NONE), sender);
    assert.equal(hideEvents(watcher).length, 1);
});

test("a friends-sharing player's cursor reaches only their friends", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_FRIENDS), sender);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 0, "a stranger sees nothing");

    game.dispatchMessage(new AddFriendMessage(watcher.playerId), sender);
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 1, "a friend sees the cursor");
});

test("narrowing the share setting to friends erases the shown cursor for strangers", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_FRIENDS), sender);
    assert.equal(hideEvents(watcher).length, 1, "the stranger viewer loses the cursor");
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 1, "later heartbeats stay filtered");
});

test("a viewer displaying no cursors receives no cursors", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_NONE), watcher);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 0);
});

test("a viewer displaying friends only receives only their friends' cursors", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_FRIENDS), watcher);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 0, "a stranger's cursor is filtered out");

    game.dispatchMessage(new AddFriendMessage(sender.playerId), watcher);
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 1, "a befriended sender's cursor arrives");
});

test("narrowing the display setting erases the shown cursors it no longer admits", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 1);
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_FRIENDS), watcher);
    const hides = hideEvents(watcher);
    assert.equal(hides.length, 1, "the shown stranger cursor is erased");
    assert.equal(hides[0].playerId, sender.playerId);
});

test("an unfriend erases a friends-displaying remover's sight of the removed player", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_FRIENDS), watcher);
    game.dispatchMessage(new AddFriendMessage(sender.playerId), watcher);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 1);

    game.dispatchMessage(new RemoveFriendMessage(sender.playerId), watcher);
    const hides = hideEvents(watcher);
    assert.equal(hides.length, 1, "the remover loses the removed player's cursor");
    assert.equal(hides[0].playerId, sender.playerId);

    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 1, "later heartbeats stay filtered");
});

test("an unfriend erases a friends-sharing player's cursor for the removed friend", async () => {
    const {game, sender, watcher} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_FRIENDS), sender);
    game.dispatchMessage(new AddFriendMessage(watcher.playerId), sender);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 1);

    game.dispatchMessage(new RemoveFriendMessage(watcher.playerId), sender);
    const hides = hideEvents(watcher);
    assert.equal(hides.length, 1, "the removed friend loses the cursor");
    assert.equal(hides[0].playerId, sender.playerId);

    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(cursorEvents(watcher).length, 1, "later heartbeats stay filtered");
});
