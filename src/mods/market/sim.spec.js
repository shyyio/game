import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGame} from "@/test/ecsSim.js";
import {CapturingSession} from "@/test/CapturingSession.js";
import {flattenBatches} from "@/test/EventCollector.js";
import {
    EMPTY, Direction, CHUNK_SIZE, chunkKeyAt, CreateObjectMessage, ClaimChunkMessage,
    PlayerSettingsUpdateEvent, ModPackage, AbstractModDeclaration, MarketListingEntry, SetViewportMessage,
} from "@spup/sdk";
import {TradingTerminalType} from "./common/objectTypes.js";
import {ConfigureTradingTerminalMessage, MarketSnapshotRequestMessage} from "./common/messages.js";
import {MarketSnapshotEvent, TradeSettledEvent, TradeSettledBatchEvent, MARKET_SNAPSHOT_NONE} from "./common/events.js";
import {
    MARKET_MODE_SELL, MARKET_MODE_BUY, MARKET_SETTING_BALANCE, MARKET_STARTING_BALANCE,
} from "./common/constants.js";

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

/**
 * Drops the connect-time starting grant, so each test funds exactly the side it means to.
 * @returns {void}
 */
function clearBalances(game, ...sessions) {
    for (const session of sessions) {
        game.playerSettings.setPlayerValue(session.playerRef, MARKET_SETTING_BALANCE, 0);
    }
}

async function gameWithSessions(extraPackages = []) {
    const game = await makeGame(extraPackages);
    const seller = new CapturingSession(1);
    const buyer = new CapturingSession(2);
    game.connect(seller);
    game.connect(buyer);
    clearBalances(game, seller, buyer);
    return {game, seller, buyer};
}

/**
 * Claims a chunk for `session` and places a configured terminal in it, returning the placed eid.
 * @returns {number}
 */
function placeTerminal(game, session, tileX, tileY, mode, itemTypeId, price) {
    const chunkKey = chunkKeyAt(tileX, tileY);
    game.dispatchMessage(new ClaimChunkMessage(chunkKey), session);
    game.dispatchMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, tileX, tileY, Direction.UP), session);
    const eid = game.simEngine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId).at(-1);
    const objectRef = game.simEngine.placed.getObjectRefByEid(eid);
    game.dispatchMessage(new ConfigureTradingTerminalMessage(objectRef, mode, itemTypeId, price), session);
    return eid;
}

function balanceUpdates(session) {
    return session.events.filter(event => event instanceof PlayerSettingsUpdateEvent && event.key === MARKET_SETTING_BALANCE);
}

function getBalanceByEid(game, playerRef) {
    return game.playerSettings.getPlayerValueByKey(playerRef, MARKET_SETTING_BALANCE) || 0;
}

test("a player-market trade pays the seller and charges the buyer, at the buyer's price", async () => {
    const {game, seller, buyer} = await gameWithSessions();
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, 3);
    placeTerminal(game, buyer, 5 + CHUNK_SIZE * 4, 5, MARKET_MODE_BUY, ITEM, PRICE);
    game.playerSettings.setPlayerValue(buyer.playerRef, MARKET_SETTING_BALANCE, 1000);

    const inputPort = game.simEngine.components.getComponentByName("MarketTerminal").store.inputPort[game.simEngine.components.getComponentByName("MarketTerminal").getRowByEid(sellerEid)];
    game.simEngine.ports.setItem(inputPort, ITEM);
    // Cached balance refreshes only at tick end; second tick needed to see funding take effect.
    game.runTick();
    game.runTick();

    assert.equal(getBalanceByEid(game, seller.playerRef), PRICE, "the seller is credited the buyer's price, not their own floor");
    assert.equal(getBalanceByEid(game, buyer.playerRef), 1000 - PRICE);
});

test("a buyer with insufficient balance never wins a trade", async () => {
    const {game, seller, buyer} = await gameWithSessions();
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    placeTerminal(game, buyer, 5 + CHUNK_SIZE * 4, 5, MARKET_MODE_BUY, ITEM, PRICE);

    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    const inputPort = def.store.inputPort[def.getRowByEid(sellerEid)];
    game.simEngine.ports.setItem(inputPort, ITEM);
    // Run past ownership-cache warm-up tick so seller is confirmed enabled.
    game.runTick();
    game.runTick();
    assert.equal(game.simEngine.ports.getItemByPortEid(inputPort), ITEM, "nothing to sell to, since the buyer can't afford it");
    assert.equal(getBalanceByEid(game, seller.playerRef), 0);
});

test("an unclaimed chunk's terminal never trades", async () => {
    const game = await makeGame();
    const seller = new CapturingSession(1);
    const buyer = new CapturingSession(2);
    game.connect(seller);
    game.connect(buyer);
    clearBalances(game, seller, buyer);
    // Claim only buyer's chunk; seller's stays unclaimed.
    game.dispatchMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 5, 5, Direction.UP), seller);
    const sellerEid = game.simEngine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId).at(-1);
    const sellerObjectRef = game.simEngine.placed.getObjectRefByEid(sellerEid);
    game.dispatchMessage(new ConfigureTradingTerminalMessage(sellerObjectRef, MARKET_MODE_SELL, ITEM, PRICE), seller);
    placeTerminal(game, buyer, 5 + CHUNK_SIZE * 4, 5, MARKET_MODE_BUY, ITEM, PRICE);
    // Fund buyer directly, isolating the case to seller's missing ownership.
    game.playerSettings.setPlayerValue(buyer.playerRef, MARKET_SETTING_BALANCE, 1000);

    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    const inputPort = def.store.inputPort[def.getRowByEid(sellerEid)];
    game.simEngine.ports.setItem(inputPort, ITEM);
    game.runTick();
    game.runTick();

    assert.equal(game.simEngine.ports.getItemByPortEid(inputPort), ITEM, "an unowned seller has nobody to be paid, so it never sells");
});

test("an NPC-priced item trades without any buy terminal, crediting the seller's chunk owner", async () => {
    const {game, seller} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    const inputPort = def.store.inputPort[def.getRowByEid(sellerEid)];
    game.simEngine.ports.setItem(inputPort, ITEM);
    // sellEnabled refreshes only at tick end; first tick runs on stale cache.
    game.runTick();
    game.runTick();
    assert.equal(getBalanceByEid(game, seller.playerRef), PRICE);
    assert.ok(balanceUpdates(seller).some(event => event.value === PRICE));
});

test("a buy terminal on an NPC-priced item purchases from the NPC, no seller needed", async () => {
    const {game, buyer} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const buyerEid = placeTerminal(game, buyer, 5, 5, MARKET_MODE_BUY, ITEM, PRICE);
    game.playerSettings.setPlayerValue(buyer.playerRef, MARKET_SETTING_BALANCE, 1000);
    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    const outputPort = def.store.outputPort[def.getRowByEid(buyerEid)];

    // Cached balance refreshes only at tick end; second tick needed to see funding take effect.
    game.runTick();
    game.runTick();

    assert.equal(game.simEngine.ports.getItemByPortEid(outputPort), ITEM, "the NPC delivered straight into the terminal's output");
    assert.equal(getBalanceByEid(game, buyer.playerRef), 1000 - PRICE);
    assert.ok(balanceUpdates(buyer).some(event => event.value === 1000 - PRICE));
});

test("a buy terminal on an NPC-priced item never purchases without enough balance", async () => {
    const {game, buyer} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const buyerEid = placeTerminal(game, buyer, 5, 5, MARKET_MODE_BUY, ITEM, PRICE);
    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    const outputPort = def.store.outputPort[def.getRowByEid(buyerEid)];

    game.runTick();
    game.runTick();

    assert.equal(game.simEngine.ports.getItemByPortEid(outputPort), EMPTY, "no balance, nothing bought");
    assert.equal(getBalanceByEid(game, buyer.playerRef), 0);
});

test("a buy terminal keeps purchasing from the NPC every tick its output is free", async () => {
    const {game, buyer} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const buyerEid = placeTerminal(game, buyer, 5, 5, MARKET_MODE_BUY, ITEM, PRICE);
    game.playerSettings.setPlayerValue(buyer.playerRef, MARKET_SETTING_BALANCE, 1000);
    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    const outputPort = def.store.outputPort[def.getRowByEid(buyerEid)];

    game.runTick();
    for (let i = 0; i < 5; i += 1) {
        game.runTick();
        assert.equal(game.simEngine.ports.getItemByPortEid(outputPort), ITEM, `tick ${i}: bought`);
        game.simEngine.ports.setItem(outputPort, EMPTY);
    }
    assert.equal(getBalanceByEid(game, buyer.playerRef), 1000 - PRICE * 5);
});

test("the market snapshot reports the tradable catalog and the requested terminal's own config", async () => {
    const {game, seller} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    const objectRef = game.simEngine.placed.getObjectRefByEid(sellerEid);
    game.dispatchMessage(new MarketSnapshotRequestMessage(objectRef), seller);
    const snapshot = seller.events.find(event => event instanceof MarketSnapshotEvent);
    assert.ok(snapshot);
    const index = snapshot.itemTypeIds.indexOf(ITEM);
    assert.notEqual(index, -1);
    assert.equal(snapshot.npcPrices[index], PRICE);
    assert.equal(snapshot.currentMode, MARKET_MODE_SELL);
    assert.equal(snapshot.currentItemTypeId, ITEM);
    assert.equal(snapshot.currentPrice, PRICE);
});

test("a snapshot request for an unconfigured terminal reports MARKET_SNAPSHOT_NONE", async () => {
    const {game, buyer} = await gameWithSessions();
    game.dispatchMessage(new ClaimChunkMessage(chunkKeyAt(5, 5)), buyer);
    game.dispatchMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 5, 5, Direction.UP), buyer);
    const eid = game.simEngine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId).at(-1);
    const objectRef = game.simEngine.placed.getObjectRefByEid(eid);
    game.dispatchMessage(new MarketSnapshotRequestMessage(objectRef), buyer);
    const snapshot = buyer.events.find(event => event instanceof MarketSnapshotEvent);
    assert.equal(snapshot.currentItemTypeId, MARKET_SNAPSHOT_NONE);
    assert.equal(snapshot.currentPrice, MARKET_SNAPSHOT_NONE);
});

test("configuring with a non-positive price on a player-market item is rejected", async () => {
    const {game, seller} = await gameWithSessions();
    game.dispatchMessage(new ClaimChunkMessage(chunkKeyAt(5, 5)), seller);
    game.dispatchMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 5, 5, Direction.UP), seller);
    const eid = game.simEngine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId).at(-1);
    const objectRef = game.simEngine.placed.getObjectRefByEid(eid);
    game.dispatchMessage(new ConfigureTradingTerminalMessage(objectRef, MARKET_MODE_SELL, ITEM, 0), seller);
    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    assert.equal(def.store.mode[def.getRowByEid(eid)], 0, "the rejected configure never wrote MARKET_MODE_SELL");
});

test("a sustained trade keeps settling every tick (full throughput, end to end)", async () => {
    const {game, seller, buyer} = await gameWithSessions();
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    const buyerEid = placeTerminal(game, buyer, 5 + CHUNK_SIZE * 4, 5, MARKET_MODE_BUY, ITEM, PRICE);
    game.playerSettings.setPlayerValue(buyer.playerRef, MARKET_SETTING_BALANCE, 1000);

    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    const inputPort = def.store.inputPort[def.getRowByEid(sellerEid)];
    const outputPort = def.store.outputPort[def.getRowByEid(buyerEid)];

    // Tick 1: cached balance still 0 (refreshed only in postTick), nothing trades yet.
    game.simEngine.ports.setItem(inputPort, ITEM);
    game.runTick();
    // Cache now reflects funded balance; every following tick should trade.
    for (let i = 0; i < 5; i += 1) {
        game.simEngine.ports.setItem(inputPort, ITEM);
        game.runTick();
        assert.equal(game.simEngine.ports.getItemByPortEid(outputPort), ITEM, `tick ${i}: delivered`);
        game.simEngine.ports.setItem(outputPort, EMPTY);
    }
    assert.equal(getBalanceByEid(game, seller.playerRef), PRICE * 5);
    assert.equal(getBalanceByEid(game, buyer.playerRef), 1000 - PRICE * 5);
});

test("a first-time player is granted a starting balance, a returning one is not topped up", async () => {
    const game = await makeGame();
    const player = new CapturingSession(1);
    game.connect(player);
    assert.equal(getBalanceByEid(game, player.playerRef), MARKET_STARTING_BALANCE);

    game.playerSettings.setPlayerValue(player.playerRef, MARKET_SETTING_BALANCE, 0);
    game.connect(new CapturingSession(1));
    assert.equal(getBalanceByEid(game, player.playerRef), 0, "a player who spent down to 0 is not re-granted");
});

test("a settled sale floats its credit over the seller's terminal", async () => {
    const {game, seller} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(5, 5)]), seller);
    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    game.simEngine.ports.setItem(def.store.inputPort[def.getRowByEid(sellerEid)], ITEM);
    game.runTick();
    game.runTick();

    const settled = flattenBatches(seller.events).filter(event => event instanceof TradeSettledEvent);
    assert.equal(settled.length, 1);
    assert.equal(settled[0].objectRef, game.simEngine.placed.getObjectRefByEid(sellerEid));
    assert.equal(settled[0].amount, PRICE, "a sale credits, so the amount is positive");
});

test("an NPC purchase floats its debit over the buying terminal", async () => {
    const {game, buyer} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const buyerEid = placeTerminal(game, buyer, 5, 5, MARKET_MODE_BUY, ITEM, PRICE);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(5, 5)]), buyer);
    game.playerSettings.setPlayerValue(buyer.playerRef, MARKET_SETTING_BALANCE, 1000);
    game.runTick();
    game.runTick();

    const settled = flattenBatches(buyer.events).filter(event => event instanceof TradeSettledEvent);
    assert.equal(settled.length, 1);
    assert.equal(settled[0].objectRef, game.simEngine.placed.getObjectRefByEid(buyerEid));
    assert.equal(settled[0].amount, -PRICE, "a purchase debits, so the amount is negative");
});

test("a player-market trade floats each side over its own terminal", async () => {
    const {game, seller, buyer} = await gameWithSessions();
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    const buyerEid = placeTerminal(game, buyer, 5 + CHUNK_SIZE * 4, 5, MARKET_MODE_BUY, ITEM, PRICE);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(5, 5)]), seller);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(5 + CHUNK_SIZE * 4, 5)]), buyer);
    game.playerSettings.setPlayerValue(buyer.playerRef, MARKET_SETTING_BALANCE, 1000);

    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    game.simEngine.ports.setItem(def.store.inputPort[def.getRowByEid(sellerEid)], ITEM);
    game.runTick();
    game.runTick();

    const credits = flattenBatches(seller.events).filter(event => event instanceof TradeSettledEvent);
    assert.equal(credits.length, 1);
    assert.equal(credits[0].objectRef, game.simEngine.placed.getObjectRefByEid(sellerEid));
    assert.equal(credits[0].amount, PRICE);
    const debits = flattenBatches(buyer.events).filter(event => event instanceof TradeSettledEvent);
    assert.equal(debits.length, 1);
    assert.equal(debits[0].objectRef, game.simEngine.placed.getObjectRefByEid(buyerEid));
    assert.equal(debits[0].amount, -PRICE);
});

test("a chunk that buys and sells in the same tick sends one batch carrying both", async () => {
    const {game, seller} = await gameWithSessions([new ModPackage(new NpcPriceFixtureDeclaration())]);
    const sellerEid = placeTerminal(game, seller, 5, 5, MARKET_MODE_SELL, ITEM, PRICE);
    const buyerEid = placeTerminal(game, seller, 9, 9, MARKET_MODE_BUY, ITEM, PRICE);
    game.dispatchMessage(new SetViewportMessage([chunkKeyAt(5, 5)]), seller);
    game.playerSettings.setPlayerValue(seller.playerRef, MARKET_SETTING_BALANCE, 1000);
    const def = game.simEngine.components.getComponentByName("MarketTerminal");
    game.runTick();
    game.simEngine.ports.setItem(def.store.inputPort[def.getRowByEid(sellerEid)], ITEM);
    game.runTick();

    const batches = seller.events.filter(event => event instanceof TradeSettledBatchEvent);
    assert.equal(batches.length, 1, "one envelope for the chunk, not one per settlement pass");
    const settled = flattenBatches(batches).filter(event => event instanceof TradeSettledEvent);
    assert.deepEqual(
        settled.map(event => event.objectRef).sort((a, b) => a - b),
        [
            game.simEngine.placed.getObjectRefByEid(sellerEid),
            game.simEngine.placed.getObjectRefByEid(buyerEid),
        ].sort((a, b) => a - b),
    );
});
