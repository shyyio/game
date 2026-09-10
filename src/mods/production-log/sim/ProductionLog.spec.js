import {test} from "node:test";
import assert from "node:assert/strict";
import {ProductionLog} from "./ProductionLog.js";
import {ITEM_PRODUCED_TABLE} from "../common/constants.js";
import {ItemRegistry, ItemType} from "@spup/sdk";

const ALICE = 1;
const BOB = 2;
const IRON = 321;
const COAL = 322;

test("add reports the first time a player produces an item type", () => {
    const log = new ProductionLog();
    assert.equal(log.add(ALICE, IRON, 1), true);
    assert.equal(log.add(ALICE, IRON, 2), false);
    assert.equal(log.add(ALICE, COAL, 1), true);
    assert.deepEqual(Array.from(log.getCountsByPlayerRef(ALICE)), [[IRON, 3], [COAL, 1]]);
    assert.deepEqual(Array.from(log.getCountsByPlayerRef(BOB)), []);
});

test("an item page ranks producers by count, ties by player ref, with the asker's rank", () => {
    const log = new ProductionLog();
    log.add(ALICE, IRON, 5);
    log.add(BOB, IRON, 7);
    log.add(BOB, COAL, 1);
    const page = log.getItemPageByItemTypeId(IRON, 0, ALICE);
    assert.deepEqual(page.playerRefs, [BOB, ALICE]);
    assert.deepEqual(page.scores, [7, 5]);
    assert.equal(page.requesterRank, 2);
    assert.equal(page.total, 2);

    const unranked = log.getItemPageByItemTypeId(COAL, 0, ALICE);
    assert.deepEqual(unranked.playerRefs, [BOB]);
    assert.equal(unranked.requesterRank, 0);
});

test("rankOf is the player's 1-based place on an item's board, 0 when unproduced", () => {
    const log = new ProductionLog();
    log.add(ALICE, IRON, 5);
    log.add(BOB, IRON, 7);
    assert.equal(log.getRankByPlayerRef(BOB, IRON), 1);
    assert.equal(log.getRankByPlayerRef(ALICE, IRON), 2);
    assert.equal(log.getRankByPlayerRef(ALICE, COAL), 0);
});

test("the table round-trips every count", () => {
    const log = new ProductionLog();
    log.add(ALICE, IRON, 5);
    log.add(BOB, COAL, 1);

    const tables = log.serializeTables();
    assert.equal(tables.length, 1);
    assert.equal(tables[0].name, ITEM_PRODUCED_TABLE);
    assert.equal(tables[0].rows.length, 2);

    // Stands in for the ItemRegistry: deserializeTables only asks whether a type is declared.
    const items = new ItemRegistry();
    items.register(IRON, new ItemType("iron", "items/1-gray"));
    items.register(COAL, new ItemType("coal", "items/1-gray"));

    const restored = new ProductionLog();
    restored.deserializeTables(tables[0], items);
    assert.deepEqual(Array.from(restored.getCountsByPlayerRef(ALICE)), [[IRON, 5]]);
    assert.deepEqual(Array.from(restored.getCountsByPlayerRef(BOB)), [[COAL, 1]]);
    restored.deserializeTables(undefined, items);
    assert.deepEqual(Array.from(restored.getCountsByPlayerRef(ALICE)), []);
});
