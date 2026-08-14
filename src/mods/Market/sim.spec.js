import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {
    EMPTY, Direction, CHUNK_SIZE, chunkId, CreateObjectMessage, ClaimChunkMessage,
    PlayerSettingsUpdateEvent, ModPackage, AbstractModDeclaration, MarketListingEntry,
} from "@/sdk/common.js";
import {TradingTerminalType} from "./common/objectTypes.js";
import {ConfigureTradingTerminalMessage, MarketSnapshotRequestMessage} from "./common/messages.js";
import {MarketSnapshotEvent, MARKET_SNAPSHOT_NONE} from "./common/events.js";
import {MARKET_MODE_SELL, MARKET_MODE_BUY, MARKET_SETTING_BALANCE} from "./common/constants.js";

const ITEM = 500;
const PRICE = 10;

/**
 * A fixture-only declaration listing ITEM at a fixed NPC price, for the NPC-priced tests.
 */
class NpcPriceFixtureDeclaration extends AbstractModDeclaration {

    get name() {
        return "NpcPriceFixture";
    }

    get marketListings() {
        return [new MarketListingEntry(ITEM, PRICE)];
    }
}

async function gameWithSessions(extraPackages = []) {
    const game = await makeGame(extraPackages);
    const seller = new CapturingSession(1);
    const buyer = new CapturingSession(2);
    game.connect(seller);
    game.connect(buyer);
    return {game, seller, buyer};
}

/**
 * Claims a chunk for `session` and places a configured terminal in it, returning the placed eid.
 * @returns {number}
 */
function placeTerminal(game, session, tileX, tileY, mode, itemType, price) {
    const chunk = chunkId(tileX, tileY);
    game.dispatchMessage(new ClaimChunkMessage(chunk), session);
    game.dispatchMessage(new CreateObjectMessage(TradingTerminalType.typeId, tileX, tileY, Direction.UP), session);
    const eid = game.simEngine.placed.eidsOf(TradingTerminalType.typeId).at(-1);
    const objectId = game.simEngine.placed.objectIdOf(eid);
    game.dispatchMessage(new ConfigureTradingTerminalMessage(objectId, mode, itemType, price), session);
    return eid;
}

function balanceUpdates(session) {
    return session.events.filter(event => event instanceof PlayerSettingsUpdateEvent && event.key === MARKET_SETTING_BALANCE);
}

function balanceOf(game, playerId) {
    return game.playerSettings.get(playerId, MARKET_SETTING_BALANCE) || 0;
}

test("a player-market trade pays the seller and charges the buyer, at the buyer's price", async () => {
    const {game, seller, buyer} = await gameWithSessions();
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, 3);
    placeTerminal(game, buyer, 5 + CHUNK_SIZE * 4, 5, MARKET_MODE_BUY, ITEM, PRICE);
    game.playerSettings.set(buyer.playerId, MARKET_SETTING_BALANCE, 1000);

    const inPort = game.simEngine.component("MarketTerminal").store.in[game.simEngine.component("MarketTerminal").row(sellerEid)];
    game.simEngine.setPortItem(inPort, ITEM);
    // Cached balance refreshes only at tick end; second tick needed to see funding take effect.
    game.runTick();
    game.runTick();

    assert.equal(balanceOf(game, seller.playerId), PRICE, "the seller is credited the buyer's price, not their own floor");
    assert.equal(balanceOf(game, buyer.playerId), 1000 - PRICE);
});

test("a buyer with insufficient balance never wins a trade", async () => {
    const {game, seller, buyer} = await gameWithSessions();
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    placeTerminal(game, buyer, 5 + CHUNK_SIZE * 4, 5, MARKET_MODE_BUY, ITEM, PRICE);

    const def = game.simEngine.component("MarketTerminal");
    const inPort = def.store.in[def.row(sellerEid)];
    game.simEngine.setPortItem(inPort, ITEM);
    // Run past ownership-cache warm-up tick so seller is confirmed enabled.
    game.runTick();
    game.runTick();
    assert.equal(game.simEngine.portItem(inPort), ITEM, "nothing to sell to, since the buyer can't afford it");
    assert.equal(balanceOf(game, seller.playerId), 0);
});

test("an unclaimed chunk's terminal never trades", async () => {
    const game = await makeGame();
    const seller = new CapturingSession(1);
    const buyer = new CapturingSession(2);
    game.connect(seller);
    game.connect(buyer);
    // Claim only buyer's chunk; seller's stays unclaimed.
    game.dispatchMessage(new CreateObjectMessage(TradingTerminalType.typeId, 5, 5, Direction.UP), seller);
    const sellerEid = game.simEngine.placed.eidsOf(TradingTerminalType.typeId).at(-1);
    const sellerObjectId = game.simEngine.placed.objectIdOf(sellerEid);
    game.dispatchMessage(new ConfigureTradingTerminalMessage(sellerObjectId, MARKET_MODE_SELL, ITEM, PRICE), seller);
    placeTerminal(game, buyer, 5 + CHUNK_SIZE * 4, 5, MARKET_MODE_BUY, ITEM, PRICE);
    // Fund buyer directly, isolating the case to seller's missing ownership.
    game.playerSettings.set(buyer.playerId, MARKET_SETTING_BALANCE, 1000);

    const def = game.simEngine.component("MarketTerminal");
    const inPort = def.store.in[def.row(sellerEid)];
    game.simEngine.setPortItem(inPort, ITEM);
    game.runTick();
    game.runTick();

    assert.equal(game.simEngine.portItem(inPort), ITEM, "an unowned seller has nobody to be paid, so it never sells");
});

test("an NPC-priced item trades without any buy terminal, crediting the seller's chunk owner", async () => {
    const {game, seller} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    const def = game.simEngine.component("MarketTerminal");
    const inPort = def.store.in[def.row(sellerEid)];
    game.simEngine.setPortItem(inPort, ITEM);
    // sellEnabled refreshes only at tick end; first tick runs on stale cache.
    game.runTick();
    game.runTick();
    assert.equal(balanceOf(game, seller.playerId), PRICE);
    assert.ok(balanceUpdates(seller).some(event => event.value === PRICE));
});

test("a buy terminal on an NPC-priced item purchases from the NPC, no seller needed", async () => {
    const {game, buyer} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const buyerEid = placeTerminal(game, buyer, 5, 5, MARKET_MODE_BUY, ITEM, PRICE);
    game.playerSettings.set(buyer.playerId, MARKET_SETTING_BALANCE, 1000);
    const def = game.simEngine.component("MarketTerminal");
    const outPort = def.store.out[def.row(buyerEid)];

    // Cached balance refreshes only at tick end; second tick needed to see funding take effect.
    game.runTick();
    game.runTick();

    assert.equal(game.simEngine.portItem(outPort), ITEM, "the NPC delivered straight into the terminal's output");
    assert.equal(balanceOf(game, buyer.playerId), 1000 - PRICE);
    assert.ok(balanceUpdates(buyer).some(event => event.value === 1000 - PRICE));
});

test("a buy terminal on an NPC-priced item never purchases without enough balance", async () => {
    const {game, buyer} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const buyerEid = placeTerminal(game, buyer, 5, 5, MARKET_MODE_BUY, ITEM, PRICE);
    const def = game.simEngine.component("MarketTerminal");
    const outPort = def.store.out[def.row(buyerEid)];

    game.runTick();
    game.runTick();

    assert.equal(game.simEngine.portItem(outPort), EMPTY, "no balance, nothing bought");
    assert.equal(balanceOf(game, buyer.playerId), 0);
});

test("a buy terminal keeps purchasing from the NPC every tick its output is free", async () => {
    const {game, buyer} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const buyerEid = placeTerminal(game, buyer, 5, 5, MARKET_MODE_BUY, ITEM, PRICE);
    game.playerSettings.set(buyer.playerId, MARKET_SETTING_BALANCE, 1000);
    const def = game.simEngine.component("MarketTerminal");
    const outPort = def.store.out[def.row(buyerEid)];

    game.runTick();
    for (let i = 0; i < 5; i += 1) {
        game.runTick();
        assert.equal(game.simEngine.portItem(outPort), ITEM, `tick ${i}: bought`);
        game.simEngine.setPortItem(outPort, EMPTY);
    }
    assert.equal(balanceOf(game, buyer.playerId), 1000 - PRICE * 5);
});

test("the market snapshot reports the tradable catalog and the requested terminal's own config", async () => {
    const {game, seller} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    const objectId = game.simEngine.placed.objectIdOf(sellerEid);
    game.dispatchMessage(new MarketSnapshotRequestMessage(objectId), seller);
    const snapshot = seller.events.find(event => event instanceof MarketSnapshotEvent);
    assert.ok(snapshot);
    const index = snapshot.itemTypes.indexOf(ITEM);
    assert.notEqual(index, -1);
    assert.equal(snapshot.npcPrices[index], PRICE);
    assert.equal(snapshot.currentMode, MARKET_MODE_SELL);
    assert.equal(snapshot.currentItemType, ITEM);
    assert.equal(snapshot.currentPrice, PRICE);
});

test("a snapshot request for an unconfigured terminal reports MARKET_SNAPSHOT_NONE", async () => {
    const {game, buyer} = await gameWithSessions();
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), buyer);
    game.dispatchMessage(new CreateObjectMessage(TradingTerminalType.typeId, 5, 5, Direction.UP), buyer);
    const eid = game.simEngine.placed.eidsOf(TradingTerminalType.typeId).at(-1);
    const objectId = game.simEngine.placed.objectIdOf(eid);
    game.dispatchMessage(new MarketSnapshotRequestMessage(objectId), buyer);
    const snapshot = buyer.events.find(event => event instanceof MarketSnapshotEvent);
    assert.equal(snapshot.currentItemType, MARKET_SNAPSHOT_NONE);
    assert.equal(snapshot.currentPrice, MARKET_SNAPSHOT_NONE);
});

test("configuring with a non-positive price on a player-market item is rejected", async () => {
    const {game, seller} = await gameWithSessions();
    game.dispatchMessage(new ClaimChunkMessage(chunkId(5, 5)), seller);
    game.dispatchMessage(new CreateObjectMessage(TradingTerminalType.typeId, 5, 5, Direction.UP), seller);
    const eid = game.simEngine.placed.eidsOf(TradingTerminalType.typeId).at(-1);
    const objectId = game.simEngine.placed.objectIdOf(eid);
    game.dispatchMessage(new ConfigureTradingTerminalMessage(objectId, MARKET_MODE_SELL, ITEM, 0), seller);
    const def = game.simEngine.component("MarketTerminal");
    assert.equal(def.store.mode[def.row(eid)], 0, "the rejected configure never wrote MARKET_MODE_SELL");
});

test("a sustained trade keeps settling every tick (full throughput, end to end)", async () => {
    const {game, seller, buyer} = await gameWithSessions();
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    const buyerEid = placeTerminal(game, buyer, 5 + CHUNK_SIZE * 4, 5, MARKET_MODE_BUY, ITEM, PRICE);
    game.playerSettings.set(buyer.playerId, MARKET_SETTING_BALANCE, 1000);

    const def = game.simEngine.component("MarketTerminal");
    const inPort = def.store.in[def.row(sellerEid)];
    const outPort = def.store.out[def.row(buyerEid)];

    // Tick 1: cached balance still 0 (refreshed only in postTick), nothing trades yet.
    game.simEngine.setPortItem(inPort, ITEM);
    game.runTick();
    // Cache now reflects funded balance; every following tick should trade.
    for (let i = 0; i < 5; i += 1) {
        game.simEngine.setPortItem(inPort, ITEM);
        game.runTick();
        assert.equal(game.simEngine.portItem(outPort), ITEM, `tick ${i}: delivered`);
        game.simEngine.setPortItem(outPort, EMPTY);
    }
    assert.equal(balanceOf(game, seller.playerId), PRICE * 5);
    assert.equal(balanceOf(game, buyer.playerId), 1000 - PRICE * 5);
});
