import {test} from "node:test";
import assert from "node:assert/strict";
import {Direction} from "@/common/constants.js";
import {Blueprint, BlueprintEntry} from "@/common/Blueprint.js";
import {BeltType} from "@/mods/logistics/common/objectTypes.js";
import {ecsModRegistry} from "@/test/ecsSim.js";
import {BlueprintHistoryCache, BLUEPRINT_HISTORY_DEPTH, BLUEPRINT_HISTORY_STORAGE_KEY} from "@/client/state/BlueprintHistoryCache.js";

const modRegistry = ecsModRegistry();

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

function makeBlueprint(tileX) {
    return new Blueprint([new BlueprintEntry(BeltType.objectTypeId, tileX, 0, Direction.UP)]);
}

function getSelectedTileX(history) {
    return history.selected.entries[0].tileX;
}

test("an empty history selects nothing", () => {
    const history = new BlueprintHistoryCache(modRegistry, makeStorage());

    assert.equal(history.selected, null);
    assert.equal(history.selectOlder(), false);
    assert.deepEqual([history.selectedPosition, history.count], [0, 0]);
});

test("a pushed blueprint is selected as the newest", () => {
    const history = new BlueprintHistoryCache(modRegistry, makeStorage());
    history.push(makeBlueprint(1));
    history.push(makeBlueprint(2));

    assert.equal(getSelectedTileX(history), 2);
    assert.deepEqual([history.selectedPosition, history.count], [1, 2]);
});

test("older then newer returns to the same blueprint and stops at either end", () => {
    const history = new BlueprintHistoryCache(modRegistry, makeStorage());
    history.push(makeBlueprint(1));
    history.push(makeBlueprint(2));

    assert.equal(history.selectOlder(), true);
    assert.equal(getSelectedTileX(history), 1);
    assert.equal(history.selectOlder(), false);
    assert.equal(history.selectNewer(), true);
    assert.equal(getSelectedTileX(history), 2);
    assert.equal(history.selectNewer(), false);
});

test("only the newest blueprints are kept", () => {
    const history = new BlueprintHistoryCache(modRegistry, makeStorage());
    for (let tileX = 0; tileX <= BLUEPRINT_HISTORY_DEPTH; tileX += 1) {
        history.push(makeBlueprint(tileX));
    }
    while (history.selectOlder()) {
        continue;
    }

    assert.equal(history.count, BLUEPRINT_HISTORY_DEPTH);
    assert.equal(getSelectedTileX(history), 1);
});

test("the history outlives the cache through its storage", () => {
    const storage = makeStorage();
    const history = new BlueprintHistoryCache(modRegistry, storage);
    history.push(makeBlueprint(1));
    history.push(makeBlueprint(2));

    const reloaded = new BlueprintHistoryCache(modRegistry, storage);

    assert.equal(getSelectedTileX(reloaded), 2);
    assert.equal(reloaded.selectOlder(), true);
    assert.deepEqual(reloaded.selected.entries, makeBlueprint(1).entries);
});

test("a stored blueprint this loadout cannot build is skipped but kept", () => {
    const storage = makeStorage();
    const history = new BlueprintHistoryCache(modRegistry, storage);
    history.push(makeBlueprint(1));
    history.push(makeBlueprint(2));
    const stored = JSON.parse(storage.getItem(BLUEPRINT_HISTORY_STORAGE_KEY));
    stored[0].typeNames[0] = "unloaded-mod-type";
    storage.setItem(BLUEPRINT_HISTORY_STORAGE_KEY, JSON.stringify(stored));

    const reloaded = new BlueprintHistoryCache(modRegistry, storage);
    reloaded.push(makeBlueprint(3));

    assert.equal(reloaded.count, 2);
    assert.equal(reloaded.selectOlder(), true);
    assert.equal(getSelectedTileX(reloaded), 1);
    assert.equal(JSON.parse(storage.getItem(BLUEPRINT_HISTORY_STORAGE_KEY)).length, 3);
});

test("removing a blueprint keeps the selection on the one it was on", () => {
    const history = new BlueprintHistoryCache(modRegistry, makeStorage());
    const newest = makeBlueprint(3);
    history.push(makeBlueprint(1));
    history.push(makeBlueprint(2));
    history.push(newest);
    history.selectOlder();

    history.remove(newest);

    assert.equal(getSelectedTileX(history), 2);
    assert.deepEqual([history.selectedPosition, history.count], [1, 2]);
});

test("removing the selected blueprint selects the newest", () => {
    const history = new BlueprintHistoryCache(modRegistry, makeStorage());
    const selected = makeBlueprint(1);
    history.push(selected);
    history.push(makeBlueprint(2));
    history.selectOlder();

    history.remove(selected);

    assert.equal(getSelectedTileX(history), 2);
});

test("two caches over one storage keep each other's blueprints", () => {
    const storage = makeStorage();
    const first = new BlueprintHistoryCache(modRegistry, storage);
    const second = new BlueprintHistoryCache(modRegistry, storage);
    const secondBlueprint = makeBlueprint(2);
    first.push(makeBlueprint(1));
    second.push(secondBlueprint);
    second.push(makeBlueprint(3));
    second.remove(secondBlueprint);

    const reloaded = new BlueprintHistoryCache(modRegistry, storage);

    assert.equal(reloaded.count, 2);
    assert.equal(getSelectedTileX(reloaded), 3);
    assert.equal(reloaded.selectOlder(), true);
    assert.equal(getSelectedTileX(reloaded), 1);
});
