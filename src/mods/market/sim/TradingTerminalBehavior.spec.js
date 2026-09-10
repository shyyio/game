import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGameEngine, ProbeSystem} from "@/test/ecsSim.js";
import {
    Direction, EMPTY, CreateObjectMessage, ModPackage, AbstractModDeclaration,
    MarketListingEntry,
} from "@spup/sdk";
import {TradingTerminalType} from "./../common/objectTypes.js";
import {MARKET_MODE_SELL, MARKET_MODE_BUY} from "../common/constants.js";
import {MarketBook} from "./MarketBook.js";

/**
 * A fixture-only declaration listing ITEM at a fixed NPC price, for the NPC-priced-seller test.
 */
class NpcPriceFixtureDeclaration extends AbstractModDeclaration {

    get name() {
        return "NpcPriceFixture";
    }

    get marketListings() {
        return [new MarketListingEntry(ITEM, PRICE)];
    }
}

const ITEM = 500;
const PRICE = 10;

/**
 * Places a seller at (5,5) and a buyer at (10,10) (unconnected by any belt — the market pairs them,
 * not physical adjacency), configures both directly on the ECS component (bypassing the
 * message/session layer this test doesn't need), and returns the ports + rows to drive/inspect.
 */
async function setup() {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 10, 10, Direction.UP));
    const [sellerEid, buyerEid] = engine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId);

    const terminals = engine.components.getComponentByName("MarketTerminal");
    const terminal = terminals.store;
    const sellerRow = terminals.getRowByEid(sellerEid);
    const buyerRow = terminals.getRowByEid(buyerEid);

    terminal.mode[sellerRow] = MARKET_MODE_SELL;
    terminal.itemTypeId[sellerRow] = ITEM;
    terminal.price[sellerRow] = PRICE;
    // Bypasses MarketSimMod, so ownership cache must be set directly.
    terminal.sellEnabled[sellerRow] = 1;

    terminal.mode[buyerRow] = MARKET_MODE_BUY;
    terminal.itemTypeId[buyerRow] = ITEM;
    terminal.price[buyerRow] = PRICE;
    terminal.balance[buyerRow] = 1_000_000;

    const book = engine.resolve(MarketBook);
    book.postBuy(buyerEid, ITEM, PRICE, terminal.out[buyerRow]);

    return {
        engine,
        sellerInputPort: terminal.in[sellerRow],
        buyerOutputPort: terminal.out[buyerRow],
    };
}

test("a single seller and a single buyer trade every tick, at full throughput", async () => {
    const {engine, sellerInputPort, buyerOutputPort} = await setup();
    for (let tick = 0; tick < 10; tick += 1) {
        engine.ports.setItem(sellerInputPort, ITEM);
        engine.tick();
        assert.equal(engine.ports.getItemByPortEid(buyerOutputPort), ITEM, `tick ${tick}: the buyer received a unit this tick`);
        // A belt would pull it away immediately; simulate that so the next tick isn't blocked.
        engine.ports.setItem(buyerOutputPort, EMPTY);
    }
});

test("a sell terminal never drains the wrong item type", async () => {
    const {engine, sellerInputPort, buyerOutputPort} = await setup();
    engine.ports.setItem(sellerInputPort, ITEM + 1);
    engine.tick();
    assert.equal(engine.ports.getItemByPortEid(sellerInputPort), ITEM + 1, "the wrong-type item is left resting");
    assert.equal(engine.ports.getItemByPortEid(buyerOutputPort), EMPTY);
});

test("a sell terminal does not drain without a matching buyer", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 5, 5, Direction.UP));
    const [sellerEid] = engine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId);
    const terminals = engine.components.getComponentByName("MarketTerminal");
    const terminal = terminals.store;
    const row = terminals.getRowByEid(sellerEid);
    terminal.mode[row] = MARKET_MODE_SELL;
    terminal.itemTypeId[row] = ITEM;
    terminal.price[row] = PRICE;
    terminal.sellEnabled[row] = 1;

    engine.ports.setItem(terminal.in[row], ITEM);
    engine.tick();
    assert.equal(engine.ports.getItemByPortEid(terminal.in[row]), ITEM, "nothing to sell to, so the item stays resting");
});

test("a terminal whose item a loadout change emptied trades nothing", async () => {
    const {engine, sellerInputPort, buyerOutputPort} = await setup();
    const terminals = engine.components.getComponentByName("MarketTerminal");
    for (const eid of engine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId)) {
        terminals.store.itemTypeId[terminals.getRowByEid(eid)] = EMPTY;
    }

    engine.ports.setItem(sellerInputPort, EMPTY);
    engine.tick();
    assert.equal(engine.ports.getItemByPortEid(buyerOutputPort), EMPTY, "an item type no mod declares is not tradable");
});

test("a sell terminal with sellEnabled=0 never sells, even with an eligible buyer", async () => {
    const {engine, sellerInputPort, buyerOutputPort} = await setup();
    const terminals = engine.components.getComponentByName("MarketTerminal");
    const [sellerEid] = engine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId);
    terminals.store.sellEnabled[terminals.getRowByEid(sellerEid)] = 0;

    engine.ports.setItem(sellerInputPort, ITEM);
    engine.tick();
    assert.equal(engine.ports.getItemByPortEid(sellerInputPort), ITEM, "an unowned chunk's terminal must not sell");
    assert.equal(engine.ports.getItemByPortEid(buyerOutputPort), EMPTY);
});

test("an NPC-priced sell terminal always has a counterparty, no buy terminal needed", async () => {
    const engine = await makeGameEngine([new ModPackage(new NpcPriceFixtureDeclaration())]);
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 5, 5, Direction.UP));
    const [sellerEid] = engine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId);
    const terminals = engine.components.getComponentByName("MarketTerminal");
    const terminal = terminals.store;
    const row = terminals.getRowByEid(sellerEid);
    terminal.mode[row] = MARKET_MODE_SELL;
    terminal.itemTypeId[row] = ITEM;
    terminal.price[row] = PRICE;
    terminal.sellEnabled[row] = 1;

    engine.ports.setItem(terminal.in[row], ITEM);
    engine.tick();
    assert.equal(engine.ports.getItemByPortEid(terminal.in[row]), EMPTY, "the NPC always buys, no player counterparty posted");
});

test("an NPC-priced buy terminal purchases every tick, at full throughput", async () => {
    const engine = await makeGameEngine([new ModPackage(new NpcPriceFixtureDeclaration())]);
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 5, 5, Direction.UP));
    const [buyerEid] = engine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId);
    const terminals = engine.components.getComponentByName("MarketTerminal");
    const terminal = terminals.store;
    const row = terminals.getRowByEid(buyerEid);
    terminal.mode[row] = MARKET_MODE_BUY;
    terminal.itemTypeId[row] = ITEM;
    terminal.balance[row] = 1_000_000;

    const outputPort = terminal.out[row];
    for (let tick = 0; tick < 10; tick += 1) {
        engine.tick();
        assert.equal(engine.ports.getItemByPortEid(outputPort), ITEM, `tick ${tick}: the NPC purchase landed this tick`);
        // A belt would pull it away immediately; simulate that so the next tick isn't blocked.
        engine.ports.setItem(outputPort, EMPTY);
    }
});

test("an NPC-priced buy terminal keeps buying while a consumer drains its port the same tick", async () => {
    const engine = await makeGameEngine([new ModPackage(new NpcPriceFixtureDeclaration())]);
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 5, 5, Direction.UP));
    const [buyerEid] = engine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId);
    const terminals = engine.components.getComponentByName("MarketTerminal");
    const terminal = terminals.store;
    const row = terminals.getRowByEid(buyerEid);
    terminal.mode[row] = MARKET_MODE_BUY;
    terminal.itemTypeId[row] = ITEM;
    terminal.balance[row] = 1_000_000;

    // A belt takes the resting item in the same phase the terminal submits its purchase, so the port
    // is never observed empty at submit time — the terminal has to ride that drain, not wait a tick.
    const outputPort = terminal.out[row];
    let drained = 0;
    engine.registerSystem(new ProbeSystem({submitIntents: () => {
        if (engine.ports.getItemByPortEid(outputPort) !== EMPTY) {
            drained += 1;
            engine.transfers.submitDrain(outputPort);
        }
    }}));

    const ticks = 20;
    for (let tick = 0; tick < ticks; tick += 1) {
        engine.tick();
    }
    assert.equal(drained, ticks - 1, "one purchase per tick after the first fill, not one every other tick");
});

test("two sellers racing for one buyer: the loser's item stays resting, no double-delivery", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 20, 20, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 10, 10, Direction.UP));
    const [sellerAEid, sellerBEid, buyerEid] = engine.placed.getEidsByTypeId(TradingTerminalType.objectTypeId);
    const terminals = engine.components.getComponentByName("MarketTerminal");
    const terminal = terminals.store;
    const sellerARow = terminals.getRowByEid(sellerAEid);
    const sellerBRow = terminals.getRowByEid(sellerBEid);
    const buyerRow = terminals.getRowByEid(buyerEid);

    for (const row of [sellerARow, sellerBRow]) {
        terminal.mode[row] = MARKET_MODE_SELL;
        terminal.itemTypeId[row] = ITEM;
        terminal.price[row] = PRICE;
        terminal.sellEnabled[row] = 1;
    }
    terminal.mode[buyerRow] = MARKET_MODE_BUY;
    terminal.itemTypeId[buyerRow] = ITEM;
    terminal.price[buyerRow] = PRICE;
    terminal.balance[buyerRow] = 1_000_000;
    engine.resolve(MarketBook).postBuy(buyerEid, ITEM, PRICE, terminal.out[buyerRow]);

    engine.ports.setItem(terminal.in[sellerARow], ITEM);
    engine.ports.setItem(terminal.in[sellerBRow], ITEM);
    engine.tick();

    const aDrained = engine.ports.getItemByPortEid(terminal.in[sellerARow]) === EMPTY;
    const bDrained = engine.ports.getItemByPortEid(terminal.in[sellerBRow]) === EMPTY;
    assert.notEqual(aDrained, bDrained, "exactly one seller wins the buyer's single port this tick");
    assert.equal(engine.ports.getItemByPortEid(terminal.out[buyerRow]), ITEM, "the buyer received exactly one unit");
});
