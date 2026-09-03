import {test} from "node:test";
import assert from "node:assert/strict";
import {ProductionLog} from "./ProductionLog.js";
import {ITEM_PRODUCED_RECORD} from "../common/constants.js";

const ALICE = 1;
const BOB = 2;
const IRON = 321;
const COAL = 322;

test("add reports the first time a player produces an item type", () => {
    const log = new ProductionLog();
    assert.equal(log.add(ALICE, IRON, 1), true);
    assert.equal(log.add(ALICE, IRON, 2), false);
    assert.equal(log.add(ALICE, COAL, 1), true);
    assert.deepEqual([...log.countsOf(ALICE)], [[IRON, 3], [COAL, 1]]);
    assert.deepEqual([...log.countsOf(BOB)], []);
});

test("an item page ranks producers by count, ties by player id, with the asker's rank", () => {
    const log = new ProductionLog();
    log.add(ALICE, IRON, 5);
    log.add(BOB, IRON, 7);
    log.add(BOB, COAL, 1);
    const page = log.itemPage(IRON, 0, ALICE);
    assert.deepEqual(page.playerIds, [BOB, ALICE]);
    assert.deepEqual(page.scores, [7, 5]);
    assert.equal(page.requesterRank, 2);
    assert.equal(page.total, 2);

    const unranked = log.itemPage(COAL, 0, ALICE);
    assert.deepEqual(unranked.playerIds, [BOB]);
    assert.equal(unranked.requesterRank, 0);
});

test("rankOf is the player's 1-based place on an item's board, 0 when unproduced", () => {
    const log = new ProductionLog();
    log.add(ALICE, IRON, 5);
    log.add(BOB, IRON, 7);
    assert.equal(log.rankOf(BOB, IRON), 1);
    assert.equal(log.rankOf(ALICE, IRON), 2);
    assert.equal(log.rankOf(ALICE, COAL), 0);
});

test("the record table round-trips every count", () => {
    const log = new ProductionLog();
    log.add(ALICE, IRON, 5);
    log.add(BOB, COAL, 1);

    const tables = log.serializeRecords();
    assert.equal(tables.length, 1);
    assert.equal(tables[0].name, ITEM_PRODUCED_RECORD);
    assert.equal(tables[0].rows.length, 2);

    const restored = new ProductionLog();
    restored.deserializeRecords(tables[0]);
    assert.deepEqual([...restored.countsOf(ALICE)], [[IRON, 5]]);
    assert.deepEqual([...restored.countsOf(BOB)], [[COAL, 1]]);
    restored.deserializeRecords(undefined);
    assert.deepEqual([...restored.countsOf(ALICE)], []);
});
