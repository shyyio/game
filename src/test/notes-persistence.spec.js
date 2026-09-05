import {test} from "node:test";
import assert from "node:assert/strict";
import {NodeSaveStore} from "@/server/NodeSaveStore.js";
import {chunkId} from "@/common/util.js";
import {ClaimChunkMessage} from "@/common/ClaimMessages.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {NotePlaceMessage} from "@/mods/notes/common/messages.js";
import {NoteSetEvent} from "@/mods/notes/common/events.js";

const CHUNK = chunkId(0, 0);

test("a mod's records survive a save/load: notes come back with their chunk", async () => {
    const store = new NodeSaveStore(":memory:");
    const game = await makeGame([], store);
    const author = new CapturingSession(1);
    game.connect(author);
    game.dispatchMessage(new ClaimChunkMessage(CHUNK), author);
    game.dispatchMessage(new SetViewportMessage([CHUNK]), author);
    game.dispatchMessage(new NotePlaceMessage(3, 4, 250, 750, "watch this"), author);
    await game.save();

    const restored = await makeGame([], store);
    assert.equal(await restored.load(), true);
    const viewer = new CapturingSession(1);
    restored.connect(viewer);
    restored.dispatchMessage(new SetViewportMessage([CHUNK]), viewer);

    const bundle = viewer.events.find(event => event.events !== undefined);
    const notes = bundle.events.filter(event => event instanceof NoteSetEvent);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].x, 3);
    assert.equal(notes[0].offsetMy, 750);
    assert.equal(notes[0].authorId, 1);
    assert.equal(notes[0].text, "watch this");
});
