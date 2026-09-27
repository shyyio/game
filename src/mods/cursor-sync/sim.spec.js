import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {
    SetViewportMessage, SetPlayerSettingMessage, AddFriendMessage, RemoveFriendMessage,
    CHUNK_SIZE, chunkKeyAt, Blueprint, BlueprintEntry, Direction,
} from "@spup/sdk";
import {PASTE_FIXTURE_PACKAGE, PasteSquareType} from "./pasteFixture.js";
import {
    CursorMoveMessage, CursorHideMessage, CursorSelectionStartMessage, CursorSelectionEndMessage,
    CursorPasteMessage, CursorPasteClearMessage,
} from "./common/messages.js";
import {
    PlayerCursorEvent, PlayerCursorHideEvent, PlayerSelectionStartEvent, PlayerSelectionEndEvent,
    PlayerPasteEvent, PlayerPasteClearEvent,
} from "./common/events.js";
import {
    CURSOR_SETTING_SHARE, CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_NONE, CURSOR_AUDIENCE_FRIENDS, CURSOR_AUDIENCE_EVERYONE,
} from "./common/constants.js";

async function gameWithSessions() {
    const game = await makeGame([PASTE_FIXTURE_PACKAGE]);
    const sender = new CapturingSession(1);
    const subscriber = new CapturingSession(2);
    const bystander = new CapturingSession(3);
    game.connect(sender);
    game.connect(subscriber);
    game.connect(bystander);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0)]), sender);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0)]), subscriber);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(1000, 1000)]), bystander);
    return {game, sender, subscriber, bystander};
}

function cursorEvents(session) {
    return session.events.filter(event => event instanceof PlayerCursorEvent);
}

function eventsOfClass(session, cls) {
    return session.events.filter(event => event instanceof cls);
}

function hideEvents(session) {
    return session.events.filter(event => event instanceof PlayerCursorHideEvent);
}

test("a cursor move fans out to the sessions subscribed to its chunk", async () => {
    const {game, sender, subscriber, bystander} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);

    const seen = cursorEvents(subscriber);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].playerRef, 1);
    assert.equal(seen[0].x, 4.5);
    assert.equal(cursorEvents(bystander).length, 0, "a session subscribed to another chunk gets nothing");
    assert.equal(cursorEvents(sender).length, 0, "no echo back to the owning session");
});

test("a non-sharing player's cursor moves are dropped", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_NONE), sender);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 0);
});

test("a chunk crossing hides the cursor only for viewers losing sight of it", async () => {
    const {game, sender, subscriber, bystander} = await gameWithSessions();
    // The subscriber sees both chunks; a fourth session sees only the origin chunk.
    const edgeSubscriber = new CapturingSession(4);
    game.connect(edgeSubscriber);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0)]), edgeSubscriber);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0), chunkKeyAt(CHUNK_SIZE, 0)]), subscriber);

    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorMoveMessage(CHUNK_SIZE + 0.5, 7.25), sender);

    assert.equal(hideEvents(edgeSubscriber).length, 1, "the origin-only viewer loses the cursor");
    assert.equal(hideEvents(edgeSubscriber)[0].playerRef, 1);
    assert.equal(hideEvents(subscriber).length, 0, "a viewer of both chunks keeps it");
    assert.equal(cursorEvents(subscriber).length, 2);
    assert.equal(hideEvents(bystander).length, 0);
});

test("a hide message erases the cursor for its last chunk's viewers alone", async () => {
    const {game, sender, subscriber, bystander} = await gameWithSessions();
    game.dispatchMessage(new CursorHideMessage(), sender);
    assert.equal(hideEvents(subscriber).length, 0, "never shown, nothing to hide");

    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorHideMessage(), sender);
    assert.equal(hideEvents(subscriber).length, 1);
    assert.equal(hideEvents(subscriber)[0].playerRef, 1);
    assert.equal(hideEvents(bystander).length, 0);
});

test("a disconnect erases the cursor for the remaining viewers", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.disconnect(sender.sessionRef);
    assert.equal(hideEvents(subscriber).length, 1);
    assert.equal(hideEvents(subscriber)[0].playerRef, 1);
    assert.equal(hideEvents(sender).length, 0, "the leaving session gets nothing");
});

test("a share-stopping setting write erases an already-shown cursor", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_NONE), sender);
    assert.equal(hideEvents(subscriber).length, 1);
});

test("a friends-sharing player's cursor reaches only their friends", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_FRIENDS), sender);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 0, "a stranger sees nothing");

    game.dispatchMessage(new AddFriendMessage(subscriber.playerRef), sender);
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 1, "a friend sees the cursor");
});

test("narrowing the share setting to friends erases the shown cursor for strangers", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_FRIENDS), sender);
    assert.equal(hideEvents(subscriber).length, 1, "the stranger viewer loses the cursor");
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 1, "later heartbeats stay filtered");
});

test("a viewer displaying no cursors receives no cursors", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_NONE), subscriber);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 0);
});

test("a viewer displaying friends only receives only their friends' cursors", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_FRIENDS), subscriber);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 0, "a stranger's cursor is filtered out");

    game.dispatchMessage(new AddFriendMessage(sender.playerRef), subscriber);
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 1, "a befriended sender's cursor arrives");
});

test("narrowing the display setting erases the shown cursors it no longer admits", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 1);
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_FRIENDS), subscriber);
    const hides = hideEvents(subscriber);
    assert.equal(hides.length, 1, "the shown stranger cursor is erased");
    assert.equal(hides[0].playerRef, sender.playerRef);
});

test("an unfriend erases a friends-displaying remover's sight of the removed player", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_FRIENDS), subscriber);
    game.dispatchMessage(new AddFriendMessage(sender.playerRef), subscriber);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 1);

    game.dispatchMessage(new RemoveFriendMessage(sender.playerRef), subscriber);
    const hides = hideEvents(subscriber);
    assert.equal(hides.length, 1, "the remover loses the removed player's cursor");
    assert.equal(hides[0].playerRef, sender.playerRef);

    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 1, "later heartbeats stay filtered");
});

test("an unfriend erases a friends-sharing player's cursor for the removed friend", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_FRIENDS), sender);
    game.dispatchMessage(new AddFriendMessage(subscriber.playerRef), sender);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 1);

    game.dispatchMessage(new RemoveFriendMessage(subscriber.playerRef), sender);
    const hides = hideEvents(subscriber);
    assert.equal(hides.length, 1, "the removed friend loses the cursor");
    assert.equal(hides[0].playerRef, sender.playerRef);

    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(cursorEvents(subscriber).length, 1, "later heartbeats stay filtered");
});

test("a selection start reaches the viewers of the sender's cursor", async () => {
    const {game, sender, subscriber, bystander} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);

    const starts = eventsOfClass(subscriber, PlayerSelectionStartEvent);
    assert.equal(starts.length, 1);
    assert.equal(starts[0].playerRef, sender.playerRef);
    assert.equal(starts[0].x, 2.5);
    assert.equal(starts[0].toolId, 40);
    assert.equal(eventsOfClass(bystander, PlayerSelectionStartEvent).length, 0);
    assert.equal(eventsOfClass(sender, PlayerSelectionStartEvent).length, 0, "no echo");
});

test("a viewer arriving later gets the open selection before the next heartbeat", async () => {
    const {game, sender} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);
    const late = new CapturingSession(4);
    game.connect(late);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0)]), late);

    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    game.dispatchMessage(new CursorMoveMessage(6.5, 7.25), sender);
    const relayed = late.events.filter(event => event instanceof PlayerSelectionStartEvent || event instanceof PlayerCursorEvent);
    assert.deepEqual(relayed.map(event => event.constructor), [PlayerSelectionStartEvent, PlayerCursorEvent, PlayerCursorEvent]);
});

test("a chunk crossing replays the selection only to viewers who lost sight of it", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    const edgeSubscriber = new CapturingSession(4);
    game.connect(edgeSubscriber);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0)]), edgeSubscriber);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0), chunkKeyAt(CHUNK_SIZE, 0)]), subscriber);

    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);
    game.dispatchMessage(new CursorMoveMessage(CHUNK_SIZE + 0.5, 7.25), sender);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);

    assert.equal(eventsOfClass(edgeSubscriber, PlayerSelectionStartEvent).length, 2, "re-shown after the hide");
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 1, "kept sight, no repeat");
});

test("a viewer resubscribing to the cursor's chunk gets the selection again", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(1000, 1000)]), subscriber);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0)]), subscriber);

    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 2);
});

test("a viewer who dropped the cursor's chunk gets the selection again when it crosses into one they see", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0), chunkKeyAt(CHUNK_SIZE, 0)]), subscriber);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(CHUNK_SIZE, 0)]), subscriber);

    game.dispatchMessage(new CursorMoveMessage(CHUNK_SIZE + 0.5, 7.25), sender);
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 2);
});

test("a display setting narrowed and widened again replays the selection", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_NONE), subscriber);
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_EVERYONE), subscriber);

    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 2);
});

test("an unfriend and re-friend replays the selection", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_FRIENDS), subscriber);
    game.dispatchMessage(new AddFriendMessage(sender.playerRef), subscriber);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);
    game.dispatchMessage(new RemoveFriendMessage(sender.playerRef), subscriber);
    game.dispatchMessage(new AddFriendMessage(sender.playerRef), subscriber);

    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 2);
});

test("the selection outlives its cursor: opened unseen, hidden, or unshared, it shows with the cursor", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 0, "no cursor shown yet");
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 1);

    game.dispatchMessage(new CursorHideMessage(), sender);
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 2);

    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_NONE), sender);
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_SHARE, CURSOR_AUDIENCE_EVERYONE), sender);
    game.dispatchMessage(new CursorMoveMessage(6.5, 7.25), sender);
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 3);
});

test("a selection end reaches the viewers and is not replayed", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);
    game.dispatchMessage(new CursorSelectionEndMessage(), sender);
    const ends = eventsOfClass(subscriber, PlayerSelectionEndEvent);
    assert.equal(ends.length, 1);
    assert.equal(ends[0].playerRef, sender.playerRef);

    game.dispatchMessage(new CursorHideMessage(), sender);
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 1);
});

test("a paste reaches the viewers and is replayed to a late one", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    const blueprint = new Blueprint([new BlueprintEntry(PasteSquareType.objectTypeId, 0, 0, Direction.UP)]);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorPasteMessage(blueprint, game.modRegistry), sender);
    const pastes = eventsOfClass(subscriber, PlayerPasteEvent);
    assert.equal(pastes.length, 1);
    assert.equal(pastes[0].playerRef, sender.playerRef);
    assert.equal(pastes[0].tileWidth, 2);
    assert.deepEqual(pastes[0].runs, [0, 4]);

    const late = new CapturingSession(4);
    game.connect(late);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0)]), late);
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(eventsOfClass(late, PlayerPasteEvent).length, 1);
});

test("a paste clear reaches the viewers and is not replayed", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    const blueprint = new Blueprint([new BlueprintEntry(PasteSquareType.objectTypeId, 0, 0, Direction.UP)]);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorPasteMessage(blueprint, game.modRegistry), sender);
    game.dispatchMessage(new CursorPasteClearMessage(), sender);
    assert.equal(eventsOfClass(subscriber, PlayerPasteClearEvent).length, 1);

    game.dispatchMessage(new CursorHideMessage(), sender);
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(eventsOfClass(subscriber, PlayerPasteEvent).length, 1);
});

test("a viewer displaying no cursors receives no previews", async () => {
    const {game, sender, subscriber} = await gameWithSessions();
    game.dispatchMessage(new SetPlayerSettingMessage(CURSOR_SETTING_DISPLAY, CURSOR_AUDIENCE_NONE), subscriber);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);
    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(eventsOfClass(subscriber, PlayerSelectionStartEvent).length, 0);
});

test("a viewer arriving while the cursor rests gets the whole preview with the next heartbeat", async () => {
    const {game, sender} = await gameWithSessions();
    const blueprint = new Blueprint([new BlueprintEntry(PasteSquareType.objectTypeId, 0, 0, Direction.UP)]);
    game.dispatchMessage(new CursorMoveMessage(4.5, 7.25), sender);
    game.dispatchMessage(new CursorPasteMessage(blueprint, game.modRegistry), sender);
    const late = new CapturingSession(4);
    game.connect(late);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(0, 0)]), late);
    game.dispatchMessage(new CursorSelectionStartMessage(2.5, 3.5, 40), sender);
    assert.equal(eventsOfClass(late, PlayerSelectionStartEvent).length, 0, "no preview before the cursor");

    game.dispatchMessage(new CursorMoveMessage(5.5, 7.25), sender);
    assert.equal(eventsOfClass(late, PlayerSelectionStartEvent).length, 1);
    assert.equal(eventsOfClass(late, PlayerPasteEvent).length, 1);
});
