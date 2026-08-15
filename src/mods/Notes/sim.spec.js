import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {ClaimChunkMessage, SetViewportMessage, chunkId} from "@spup/sdk";
import {NotePlaceMessage, NoteEditMessage, NoteDeleteMessage} from "./common/messages.js";
import {NoteSetEvent, NoteDeleteEvent} from "./common/events.js";

const CHUNK = chunkId(0, 0);
const FOREIGN_CHUNK = chunkId(1000, 1000);
// ChunkPermission.PERMISSION_FRIENDS; the engine's claim enum is not part of the mod SDK.
const PERMISSION_FRIENDS = 1;

/**
 * A game with an owner watching their claimed chunk and a neighbor watching the same chunk.
 */
async function claimedWorld() {
    const game = await makeGame();
    const owner = new CapturingSession(1);
    const neighbor = new CapturingSession(2);
    game.connect(owner);
    game.connect(neighbor);
    game.dispatchMessage(new ClaimChunkMessage(CHUNK), owner);
    game.dispatchMessage(new SetViewportMessage([CHUNK]), owner);
    game.dispatchMessage(new SetViewportMessage([CHUNK]), neighbor);
    return {game, owner, neighbor};
}

function setEvents(session) {
    return session.events.filter(event => event instanceof NoteSetEvent);
}

function deleteEvents(session) {
    return session.events.filter(event => event instanceof NoteDeleteEvent);
}

test("a placed note fans out to the chunk's viewers, the author's name first", async () => {
    const {game, owner, neighbor} = await claimedWorld();
    game.dispatchMessage(new NotePlaceMessage(3, 4, 250, 750, "watch this"), owner);

    const seen = setEvents(neighbor);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].x, 3);
    assert.equal(seen[0].offsetMx, 250);
    assert.equal(seen[0].authorId, 1);
    assert.equal(seen[0].text, "watch this");
    const nameIndex = neighbor.events.findIndex(event => event.playerIds !== undefined && event.playerIds.includes(1));
    assert.ok(nameIndex !== -1 && nameIndex < neighbor.events.indexOf(seen[0]), "the author's name arrives before the note");
    assert.equal(setEvents(owner).length, 1, "the author sees their own note too");
});

test("a note needs build rights on its chunk", async () => {
    const {game, neighbor} = await claimedWorld();
    game.dispatchMessage(new NotePlaceMessage(3, 4, 0, 0, "not mine"), neighbor);
    assert.equal(setEvents(neighbor).length, 0);

    const stranger = new CapturingSession(3);
    game.connect(stranger);
    game.dispatchMessage(new SetViewportMessage([FOREIGN_CHUNK]), stranger);
    game.dispatchMessage(new NotePlaceMessage(1000, 1000, 0, 0, "unclaimed"), stranger);
    assert.equal(setEvents(stranger).length, 0, "an unclaimed chunk takes no notes");
});

test("a tile holds one note: a foreign note blocks, the author's own is overwritten", async () => {
    const {game, owner, neighbor} = await claimedWorld();
    game.dispatchMessage(new ClaimChunkMessage(FOREIGN_CHUNK), neighbor);
    game.dispatchMessage(new SetViewportMessage([CHUNK, FOREIGN_CHUNK]), neighbor);
    game.dispatchMessage(new NotePlaceMessage(3, 4, 0, 0, "first"), owner);

    game.dispatchMessage(new NotePlaceMessage(3, 4, 0, 0, "second"), neighbor);
    assert.equal(setEvents(neighbor).length, 1, "another player's note is not replaced");

    game.dispatchMessage(new NotePlaceMessage(3, 4, 500, 500, "mine again"), owner);
    const seen = setEvents(neighbor);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].text, "mine again");
});

test("only the author edits a note, claim or no claim", async () => {
    const {game, owner, neighbor} = await claimedWorld();
    game.dispatchMessage(new NotePlaceMessage(3, 4, 0, 0, "first"), owner);

    game.dispatchMessage(new NoteEditMessage(3, 4, "hijacked"), neighbor);
    assert.equal(setEvents(neighbor).length, 1, "a non-author edit is dropped");

    // Losing the chunk does not lock the author out of their own note.
    game.claims.unclaim(1, CHUNK);
    game.dispatchMessage(new NoteEditMessage(3, 4, "still mine"), owner);
    const seen = setEvents(neighbor);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].text, "still mine");
});

test("a note is deleted by its author or by a build-rights holder", async () => {
    const {game, owner, neighbor} = await claimedWorld();
    game.dispatchMessage(new NotePlaceMessage(3, 4, 0, 0, "first"), owner);

    game.dispatchMessage(new NoteDeleteMessage(3, 4), neighbor);
    assert.equal(deleteEvents(neighbor).length, 0, "a stranger deletes nothing");

    game.players.addFriend(1, 2);
    game.claims.setPermission(1, CHUNK, PERMISSION_FRIENDS);
    game.dispatchMessage(new NoteDeleteMessage(3, 4), neighbor);
    assert.equal(deleteEvents(neighbor).length, 1, "a friend building in the chunk may delete");

    game.dispatchMessage(new NotePlaceMessage(5, 6, 0, 0, "second"), owner);
    game.dispatchMessage(new NoteDeleteMessage(5, 6), owner);
    assert.equal(deleteEvents(owner).length, 2);
});

test("a late subscriber gets the chunk's notes in its sync bundle, names first", async () => {
    const {game, owner} = await claimedWorld();
    game.dispatchMessage(new NotePlaceMessage(3, 4, 250, 750, "watch this"), owner);

    const latecomer = new CapturingSession(4);
    game.connect(latecomer);
    game.dispatchMessage(new SetViewportMessage([CHUNK]), latecomer);

    const bundle = latecomer.events.find(event => event.events !== undefined);
    const notes = bundle.events.filter(event => event instanceof NoteSetEvent);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, "watch this");
    const nameIndex = latecomer.events.findIndex(event => event.playerIds !== undefined && event.playerIds.includes(1));
    assert.ok(nameIndex !== -1 && nameIndex < latecomer.events.indexOf(bundle), "the author's name precedes the bundle");
});
