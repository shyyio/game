import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";
import {UndoCache, NOTHING_PLACED, UNDO_DEPTH} from "@/client/state/UndoCache.js";

const OBJECT_TYPE_ID = 7;
const PLACED_OBJECT = {tileX: 5, tileY: 6, data: {type: {objectTypeId: OBJECT_TYPE_ID}, direction: Direction.LEFT}};

function makeClient() {
    const client = {
        sent: [],
        clipboard: null,
        blueprintTool: {},
        hud: {toolbarLayer: {activeTool: null}},
    };
    client.session = {sendMessage: message => client.sent.push(message)};
    return client;
}

test("undoing a placement deletes it by tile, before the placement has echoed back", () => {
    const client = makeClient();
    const undo = new UndoCache(client);
    undo.add(new Blueprint([new BlueprintEntry(OBJECT_TYPE_ID, 5, 6, Direction.LEFT)]), []);

    undo.undo();

    assert.equal(client.sent.length, 1);
    assert.deepEqual([client.sent[0].objectTypeIds, client.sent[0].tileX, client.sent[0].tileY], [[OBJECT_TYPE_ID], [5], [6]]);
});

test("undoing a delete places the object back and restores the clipboard", () => {
    const client = makeClient();
    const undo = new UndoCache(client);
    const before = new Blueprint([]);
    client.clipboard = before;
    undo.add(NOTHING_PLACED, [PLACED_OBJECT]);
    client.clipboard = new Blueprint([]);

    undo.undo();

    assert.deepEqual([client.sent[0].tileX, client.sent[0].tileY], [[5], [6]]);
    assert.equal(client.clipboard, before);
});

test("redo repeats what undo reverted, clipboard included", () => {
    const client = makeClient();
    const undo = new UndoCache(client);
    const copied = new Blueprint([]);
    undo.add(NOTHING_PLACED, [PLACED_OBJECT]);
    client.clipboard = copied;
    undo.undo();
    client.sent = [];

    assert.equal(undo.redo(), true);

    assert.deepEqual([client.sent[0].objectTypeIds, client.sent[0].tileX], [[OBJECT_TYPE_ID], [5]]);
    assert.equal(client.clipboard, copied);
});

test("a new action drops what could be redone", () => {
    const client = makeClient();
    const undo = new UndoCache(client);
    undo.add(NOTHING_PLACED, []);
    undo.undo();

    undo.add(NOTHING_PLACED, []);

    assert.equal(undo.redo(), false);
});

test("only the newest actions are kept", () => {
    const client = makeClient();
    const undo = new UndoCache(client);
    for (let i = 0; i < UNDO_DEPTH + 1; i += 1) {
        undo.add(NOTHING_PLACED, []);
    }
    for (let i = 0; i < UNDO_DEPTH; i += 1) {
        undo.undo();
    }

    assert.equal(undo.undo(), false);
});
