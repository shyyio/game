import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGameEngine} from "@/test/ecsSim.js";
import {Direction, EMPTY, CreateObjectMessage} from "@spup/sdk";
import {TradingTerminalType} from "@/mods/market/common/objectTypes.js";
import {MARKET_MODE_SELL, MARKET_MODE_BUY} from "@/mods/market/common/constants.js";
import {MarketBook} from "@/mods/market/sim/MarketBook.js";
import {placeBelt, beltLaneAt} from "@/test/beltFixture.js";

const ITEM = 500;
const PRICE = 10;
const TICKS = 30;

/**
 * @param {GameEngine} engine
 * @param {number} port
 * @returns {number} 1 when the port holds an item
 */
function held(engine, port) {
    if (engine.ports.item(port) === EMPTY) {
        return 0;
    }
    return 1;
}

// The belt pops its lead into the seller's input port in the same tick the sale leaves it, so the
// resolver must have emptied that port before the transport writes, not after.
test("a belt-fed seller loses no items when a pop and a sale share a tick", async () => {
    const engine = await makeGameEngine();
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 5, 5, Direction.UP));
    engine.applyMessage(new CreateObjectMessage(TradingTerminalType.objectTypeId, 10, 10, Direction.UP));
    const [sellerEid, buyerEid] = engine.placed.eidsOf(TradingTerminalType.objectTypeId);
    const def = engine.components.get("MarketTerminal");
    const terminal = def.store;
    const sellerRow = def.row(sellerEid);
    const buyerRow = def.row(buyerEid);
    terminal.mode[sellerRow] = MARKET_MODE_SELL;
    terminal.itemTypeId[sellerRow] = ITEM;
    terminal.price[sellerRow] = PRICE;
    terminal.sellEnabled[sellerRow] = 1;
    terminal.mode[buyerRow] = MARKET_MODE_BUY;
    terminal.itemTypeId[buyerRow] = ITEM;
    terminal.price[buyerRow] = PRICE;
    terminal.balance[buyerRow] = 1_000_000;
    engine.resolve(MarketBook).postBuy(buyerEid, ITEM, PRICE, terminal.out[buyerRow]);
    const sellerInputPort = terminal.in[sellerRow];
    const buyerOutputPort = terminal.out[buyerRow];

    // Belt line (5,7)->(5,6) facing UP feeds tile (5,5): the seller adopts the shared port.
    placeBelt(engine, 5, 7, Direction.UP);
    placeBelt(engine, 5, 6, Direction.UP);
    const feed = beltLaneAt(engine, 5, 7);
    assert.equal(feed.outputPort, sellerInputPort, "the belt feeds the seller's input port");

    let fed = 0;
    let delivered = 0;
    for (let tick = 0; tick < TICKS; tick += 1) {
        if (engine.ports.item(feed.inputPort) === EMPTY) {
            engine.ports.setItem(feed.inputPort, ITEM);
            fed += 1;
        }
        engine.tick();
        if (engine.ports.item(buyerOutputPort) === ITEM) {
            delivered += 1;
            engine.ports.setItem(buyerOutputPort, EMPTY);
        }
    }

    const inTransit = engine.lanes.itemCountOf(feed.laneRef) + held(engine, feed.inputPort) + held(engine, sellerInputPort);
    assert.equal(delivered + inTransit, fed, "every fed item is delivered or still on the way");
    assert.ok(delivered >= TICKS / 2, "the line sells at a sustained rate");
});
