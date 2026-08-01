import {test} from "node:test";
import assert from "node:assert/strict";
import {MarketBook} from "./MarketBook.js";

const ITEM = 1;
const OPEN = () => true;
const CLOSED = () => false;
const RICH = () => 1_000_000;

test("a lone qualifying buyer is matched at its own price, not the seller's floor", () => {
    const book = new MarketBook(new Map());
    book.postBuy(100, ITEM, 10, /* outPort */ 1);
    const match = book.bestEligibleBuyer(ITEM, 5, OPEN, RICH);
    assert.equal(match.npc, false);
    assert.equal(match.eid, 100);
    assert.equal(match.price, 10, "settles at the buyer's own bid, not the seller's floor");
});

test("a bid below the seller's floor never matches", () => {
    const book = new MarketBook(new Map());
    book.postBuy(100, ITEM, 4, 1);
    assert.equal(book.bestEligibleBuyer(ITEM, 5, OPEN, RICH), null);
});

test("the highest-paying eligible buyer wins over a lower bidder", () => {
    const book = new MarketBook(new Map());
    book.postBuy(100, ITEM, 8, 1);
    book.postBuy(200, ITEM, 12, 2);
    const match = book.bestEligibleBuyer(ITEM, 5, OPEN, RICH);
    assert.equal(match.eid, 200);
    assert.equal(match.price, 12);
});

test("a same-price tie goes to whichever bid was posted first", () => {
    const book = new MarketBook(new Map());
    book.postBuy(100, ITEM, 10, 1);
    book.postBuy(200, ITEM, 10, 2);
    const match = book.bestEligibleBuyer(ITEM, 5, OPEN, RICH);
    assert.equal(match.eid, 100, "the earlier post wins the tie");
});

test("a buyer who can't afford their own bid is skipped for the next-best", () => {
    const book = new MarketBook(new Map());
    book.postBuy(100, ITEM, 12, 1);
    book.postBuy(200, ITEM, 8, 2);
    const broke = new Set([100]);
    const balanceOf = eid => (broke.has(eid) ? 0 : 1_000_000);
    const match = book.bestEligibleBuyer(ITEM, 5, OPEN, balanceOf);
    assert.equal(match.eid, 200, "the richer-but-lower bidder wins once the top bidder can't pay");
});

test("a buyer whose output port is currently blocked is skipped for the next-best", () => {
    const book = new MarketBook(new Map());
    book.postBuy(100, ITEM, 12, /* outPort */ 1);
    book.postBuy(200, ITEM, 8, /* outPort */ 2);
    const portIsEmpty = port => port !== 1;
    const match = book.bestEligibleBuyer(ITEM, 5, portIsEmpty, RICH);
    assert.equal(match.eid, 200, "the blocked top bidder never consumes the slot");
});

test("no trade when every crossable buyer is blocked and no NPC price covers it", () => {
    const book = new MarketBook(new Map());
    book.postBuy(100, ITEM, 12, 1);
    assert.equal(book.bestEligibleBuyer(ITEM, 5, CLOSED, RICH), null);
});

test("a player buyer wins a tie against the NPC price", () => {
    const book = new MarketBook(new Map([[ITEM, 10]]));
    book.postBuy(100, ITEM, 10, 1);
    const match = book.bestEligibleBuyer(ITEM, 5, OPEN, RICH);
    assert.equal(match.npc, false, "a tie favors the player buyer over the NPC");
});

test("the NPC wins only by strictly beating every player bid", () => {
    const book = new MarketBook(new Map([[ITEM, 12]]));
    book.postBuy(100, ITEM, 10, 1);
    const match = book.bestEligibleBuyer(ITEM, 5, OPEN, RICH);
    assert.equal(match.npc, true);
    assert.equal(match.price, 12);
});

test("the NPC price is used when no player buyer is posted at all", () => {
    const book = new MarketBook(new Map([[ITEM, 12]]));
    const match = book.bestEligibleBuyer(ITEM, 5, OPEN, RICH);
    assert.equal(match.npc, true);
    assert.equal(match.price, 12);
});

test("removing a buy quote drops it from matching and the count", () => {
    const book = new MarketBook(new Map());
    book.postBuy(100, ITEM, 10, 1);
    assert.equal(book.buyCount(ITEM), 1);
    book.removeBuy(100);
    assert.equal(book.buyCount(ITEM), 0);
    assert.equal(book.bestEligibleBuyer(ITEM, 5, OPEN, RICH), null);
});

test("reconfiguring (re-posting) a buy replaces its prior quote rather than stacking", () => {
    const book = new MarketBook(new Map());
    book.postBuy(100, ITEM, 10, 1);
    book.postBuy(100, ITEM, 20, 1);
    assert.equal(book.buyCount(ITEM), 1);
    assert.equal(book.bestEligibleBuyer(ITEM, 5, OPEN, RICH).price, 20);
});

test("bestBid/bestAsk report the extreme posted price and undefined when empty", () => {
    const book = new MarketBook(new Map());
    assert.equal(book.bestBid(ITEM), undefined);
    assert.equal(book.bestAsk(ITEM), undefined);
    book.postBuy(100, ITEM, 10, 1);
    book.postBuy(200, ITEM, 15, 2);
    assert.equal(book.bestBid(ITEM), 15);
    book.postSell(300, ITEM, 7);
    book.postSell(400, ITEM, 4);
    assert.equal(book.bestAsk(ITEM), 4);
});

test("sell count tracks posts/removals independently of matching", () => {
    const book = new MarketBook(new Map());
    book.postSell(100, ITEM, 5);
    book.postSell(200, ITEM, 6);
    assert.equal(book.sellCount(ITEM), 2);
    book.removeSell(100);
    assert.equal(book.sellCount(ITEM), 1);
});

test("recordSettlement queues for drainSettlements and drains exactly once", () => {
    const book = new MarketBook(new Map());
    book.recordSettlement(1, 2, ITEM, 10);
    book.recordSettlement(3, 4, ITEM, 20);
    const settlements = book.drainSettlements();
    assert.equal(settlements.length, 2);
    assert.deepEqual(book.drainSettlements(), [], "a second drain is empty");
});

test("a trade seeds the item's guide price immediately", () => {
    const book = new MarketBook(new Map());
    assert.equal(book.guidePriceOf(ITEM), undefined);
    book.recordSettlement(1, 2, ITEM, 50);
    assert.equal(book.guidePriceOf(ITEM), 50, "seeded from the first trade, before any recompute");
});

test("advanceTick is a no-op before its interval elapses", () => {
    const book = new MarketBook(new Map(), 10);
    book.recordSettlement(1, 2, ITEM, 50);
    for (let i = 0; i < 9; i += 1) {
        book.advanceTick();
    }
    assert.equal(book.guidePriceOf(ITEM), 50);
});

test("advanceTick nudges the guide price toward the interval's average trade price, bounded", () => {
    const book = new MarketBook(new Map(), 5);
    book.recordSettlement(1, 2, ITEM, 100);
    for (let i = 0; i < 5; i += 1) {
        book.advanceTick();
    }
    // Single trade at seed price moves nothing; post a very different batch.
    for (let i = 0; i < 60; i += 1) {
        book.recordSettlement(1, 2, ITEM, 200);
    }
    const before = book.guidePriceOf(ITEM);
    for (let i = 0; i < 5; i += 1) {
        book.advanceTick();
    }
    const after = book.guidePriceOf(ITEM);
    assert.ok(after > before, "moved toward the higher average");
    assert.ok(after - before <= Math.round(before * 0.05), "the per-interval move stays within the cap");
});

test("advanceTick nudges the guide price on a standing buy/sell imbalance with zero trades", () => {
    const book = new MarketBook(new Map(), 5);
    book.recordSettlement(1, 2, ITEM, 100);
    for (let i = 0; i < 5; i += 1) {
        book.advanceTick();
    }
    for (let i = 0; i < 10; i += 1) {
        book.postBuy(1000 + i, ITEM, 100, i);
    }
    const before = book.guidePriceOf(ITEM);
    for (let i = 0; i < 5; i += 1) {
        book.advanceTick();
    }
    assert.ok(book.guidePriceOf(ITEM) > before, "more demand than supply nudges the guide up with no trades");
});
