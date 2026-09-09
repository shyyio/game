import {test} from "node:test";
import assert from "node:assert/strict";
import {makeGameEngine} from "@/test/ecsSim.js";
import {Direction, EMPTY, CreateObjectMessage} from "@spup/sdk";
import {TradingTerminalType} from "@/mods/market/common/objectTypes.js";
import {MARKET_MODE_SELL, MARKET_MODE_BUY} from "@/mods/market/common/constants.js";
import {MarketBook} from "@/mods/market/sim/MarketBook.js";
import {beltsOf} from "@/mods/logistics/sim/testHelpers.js";

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

// The belt pops its lead into the seller's in-port in the same tick the sale leaves it, so the
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
    const sellerInPort = terminal.in[sellerRow];
    const buyerOutPort = terminal.out[buyerRow];

    // Belt line (5,7)->(5,6) facing UP feeds tile (5,5): the seller adopts the shared port.
    const belts = beltsOf(engine);
    belts.placeBelt(5, 7, Direction.UP);
    const belt = belts.placeBelt(5, 6, Direction.UP);
    assert.equal(belt.outPort, sellerInPort, "the belt feeds the seller's in-port");
    const feed = belts.pathAt(5, 7);

    let fed = 0;
    let delivered = 0;
    for (let tick = 0; tick < TICKS; tick += 1) {
        if (engine.ports.item(feed.inPort) === EMPTY) {
            engine.ports.setItem(feed.inPort, ITEM);
            fed += 1;
        }
        engine.tickAll();
        if (engine.ports.item(buyerOutPort) === ITEM) {
            delivered += 1;
            engine.ports.setItem(buyerOutPort, EMPTY);
        }
    }

    const path = belts.paths.find(candidate => candidate.id === feed.id);
    const inTransit = belts.itemCountOf(path) + held(engine, feed.inPort) + held(engine, sellerInPort);
    assert.equal(delivered + inTransit, fed, "every fed item is delivered or still on the way");
    assert.ok(delivered >= TICKS / 2, "the line sells at a sustained rate");
});
