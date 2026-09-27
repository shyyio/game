import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";
import {UndoCache, NOTHING_PLACED, UNDO_DEPTH} from "@/client/state/UndoCache.js";
import {BlueprintHistoryCache} from "@/client/state/BlueprintHistoryCache.js";
import {BeltType} from "@/mods/logistics/common/objectTypes.js";
import {ecsModRegistry} from "@/test/ecsSim.js";

const modRegistry = ecsModRegistry();
const OBJECT_TYPE_ID = BeltType.objectTypeId;
const PLACED_OBJECT = {tileX: 5, tileY: 6, data: {type: {objectTypeId: OBJECT_TYPE_ID}, direction: Direction.LEFT}};

function makeStorage() {
    const items = new Map();
    return {
        getItem: key => {
            if (!items.has(key)) {
                return null;
            }
            return items.get(key);
        },
        setItem: (key, value) => items.set(key, value),
    };
}

function makeClient() {
    const client = {
        sent: [],
        blueprints: new BlueprintHistoryCache(modRegistry, makeStorage()),
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

test("undoing a delete places the object back", () => {
    const client = makeClient();
    const undo = new UndoCache(client);
    undo.add(NOTHING_PLACED, [PLACED_OBJECT]);

    undo.undo();

    assert.deepEqual([client.sent[0].tileX, client.sent[0].tileY], [[5], [6]]);
});

test("undoing a cut places the objects back and takes its blueprint out of the history", () => {
    const client = makeClient();
    const undo = new UndoCache(client);
    const before = new Blueprint([]);
    const cut = new Blueprint([]);
    client.blueprints.push(before);
    client.blueprints.push(cut);
    undo.addCopied(cut, [PLACED_OBJECT]);

    undo.undo();

    assert.deepEqual([client.sent[0].tileX, client.sent[0].tileY], [[5], [6]]);
    assert.equal(client.blueprints.selected, before);
    assert.equal(client.blueprints.count, 1);
});

test("redo repeats what undo reverted, copied blueprint included", () => {
    const client = makeClient();
    const undo = new UndoCache(client);
    const copied = new Blueprint([]);
    client.blueprints.push(copied);
    undo.addCopied(copied, [PLACED_OBJECT]);
    undo.undo();
    client.sent = [];

    assert.equal(undo.redo(), true);

    assert.deepEqual([client.sent[0].objectTypeIds, client.sent[0].tileX], [[OBJECT_TYPE_ID], [5]]);
    assert.equal(client.blueprints.selected, copied);
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
