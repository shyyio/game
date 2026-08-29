import {AbstractBehavior, EMPTY, NO_EID, TickPhase, PLAYER_ID_NONE} from "@spup/sdk";
import {MARKET_MODE_SELL, MARKET_MODE_BUY} from "../common/constants.js";
import {MarketBook} from "./MarketBook.js";

/**
 * Trading Terminal: input port (sell mode) and output port (buy mode), both always present; live
 * one is runtime `mode`, set by MarketSimMod via ConfigureTradingTerminalMessage.
 *
 * Pure ECS port I/O, never touches Game directly (currency/ownership live in MarketSimMod.onTick).
 * Each tick, an enabled seller finds the best eligible buyer (MarketBook.bestEligibleBuyer) and
 * submits a transfer via engine.submitTransfer, letting the engine's fan-in arbitration resolve
 * contention like belts/splitters do.
 */
export class TradingTerminalBehavior extends AbstractBehavior {

    install(engine, placed) {
        const fixedPrices = new Map();
        for (const listing of engine.modRegistry.marketListings) {
            if (listing.npcPrice !== null) {
                fixedPrices.set(listing.itemType, listing.npcPrice);
            }
        }
        engine.provide(MarketBook, new MarketBook(fixedPrices));
        engine.components.define("MarketTerminal", [
            {name: "mode"},
            {name: "itemType", fill: EMPTY},
            {name: "price"},
            // Buy only: cached owner balance, refreshed per tick by MarketSimMod.onTick. Not authoritative.
            {name: "balance"},
            // Buy only: cached chunk owner, lets _submitIntents pool balance across a player's buy terminals.
            {name: "owner", fill: PLAYER_ID_NONE},
            // Sell only: whether this terminal's chunk is owned, refreshed per tick by MarketSimMod.onTick.
            {name: "sellEnabled"},
            // Sell-only scratch: price/counterparty this row is selling to this tick.
            {name: "pendingPrice", fill: EMPTY},
            {name: "pendingBuyer", kind: "eid", fill: NO_EID},
            {name: "pendingIsNpc", fill: 0},
            {name: "in", kind: "eid", fill: NO_EID},
            {name: "out", kind: "eid", fill: NO_EID},
            {name: "lastOutput", fill: EMPTY},
        ], {sparse: true});
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => TradingTerminalBehavior._submitIntents(engine));
        engine.registerSystem(TickPhase.POST_RESOLVE, () => TradingTerminalBehavior._finish(engine));
    }

    onSpawn(engine, placed, eid, type, message) {
        const def = engine.components.get("MarketTerminal");
        engine.components.attach(def, eid);
        const terminal = def.store;
        const row = def.row(eid);
        terminal.in[row] = engine.portFor(type.inputPorts[0], message.x, message.y, message.direction).port;
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        terminal.out[row] = output.port;
        engine.registerRenderedPort(output.port, output.tile.x, output.tile.y);
    }

    onDespawn(engine, placed, eid) {
        const def = engine.components.get("MarketTerminal");
        const row = def.row(eid);
        engine.unregisterRenderedPort(def.store.out[row]);
        const book = engine.resolve(MarketBook);
        book.removeBuy(eid);
        book.removeSell(eid);
    }

    syncData(engine, placed, eid) {
        const def = engine.components.get("MarketTerminal");
        const row = def.row(eid);
        const last = def.store.lastOutput[row];
        let lastOutput = last;
        if (last === EMPTY) {
            lastOutput = null;
        }
        return {portIds: [def.store.out[row]], lastOutput};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const def = engine.components.get("MarketTerminal");
        const out = def.store.out[def.row(eid)];
        engine.registerRenderedPort(out, engine.Position.x[out], engine.Position.y[out]);
    }

    /**
     * SUBMIT_INTENTS: a sell terminal armed with a live match submits exactly one transfer straight
     * into its chosen buyer's output port (or a plain drain for an NPC counterparty); a buy terminal
     * configured for an NPC-fixed-price item likewise submits a source-less create straight from the
     * NPC's infinite supply — there's no real seller to match against, so it needs only its own
     * output port free and its own cached balance to cover the price. A buy terminal on a
     * player-market item still submits nothing itself; it only ever receives via a seller's transfer.
     *
     * `reservedBalance` tracks each buyer's remaining cached balance across this single pass, keyed
     * by owning player rather than by terminal eid: a player with several buy terminals shares one
     * balance, and committing a spend against one of their terminals (a sell-side match paying them,
     * or an NPC purchase of their own) must reduce what any of their other terminals appear to have
     * left, or the same tick-stale balance would clear every one of them independently and let a
     * multi-terminal player spend past their real balance.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _submitIntents(engine) {
        const item = engine.Port.item;
        const def = engine.components.get("MarketTerminal");
        const terminal = def.store;
        const book = engine.resolve(MarketBook);
        const count = def.count;
        const reservedBalance = new Map();
        for (let row = 0; row < count; row += 1) {
            terminal.pendingPrice[row] = EMPTY;
            terminal.pendingBuyer[row] = NO_EID;
            terminal.pendingIsNpc[row] = 0;
            if (terminal.mode[row] === MARKET_MODE_BUY) {
                TradingTerminalBehavior._submitNpcPurchase(engine, item, book, terminal, row, reservedBalance);
                continue;
            }
            if (terminal.mode[row] !== MARKET_MODE_SELL || terminal.sellEnabled[row] === 0) {
                continue;
            }
            const inPort = terminal.in[row];
            if (item[inPort] !== terminal.itemType[row]) {
                continue;
            }
            const match = book.bestEligibleBuyer(
                terminal.itemType[row],
                terminal.price[row],
                port => item[port] === EMPTY,
                buyerEid => TradingTerminalBehavior._remainingBalance(def, terminal, buyerEid, reservedBalance),
            );
            if (match === null) {
                continue;
            }
            terminal.pendingPrice[row] = match.price;
            if (match.npc) {
                engine.submitDrain(inPort, true);
                terminal.pendingIsNpc[row] = 1;
            } else {
                engine.submitTransfer(inPort, match.outPort, true, true, EMPTY, terminal.itemType[row]);
                terminal.pendingBuyer[row] = match.eid;
                const owner = terminal.owner[def.row(match.eid)];
                const remaining = TradingTerminalBehavior._remainingBalance(def, terminal, match.eid, reservedBalance);
                reservedBalance.set(owner, remaining - match.price);
            }
        }
    }

    /**
     * A buy terminal configured for an NPC-fixed-price item purchases straight from the NPC's
     * infinite supply whenever its owner's remaining balance covers the price — no matching needed,
     * since there's no real seller on the other side. Player-market items have no fixed price and take
     * no action here; they stay purely passive, waiting on a seller's transfer.
     * @private
     * @param {GameEngine} engine
     * @param {Int32Array} item
     * @param {MarketBook} book
     * @param {object} terminal
     * @param {number} row
     * @param {Map<number, number>} reservedBalance owning player -> balance remaining this pass
     * @returns {void}
     */
    static _submitNpcPurchase(engine, item, book, terminal, row, reservedBalance) {
        const itemType = terminal.itemType[row];
        const fixedPrice = book.fixedPriceOf(itemType);
        if (fixedPrice === undefined) {
            return;
        }
        const outPort = terminal.out[row];
        const owner = terminal.owner[row];
        let remaining = terminal.balance[row];
        if (reservedBalance.has(owner)) {
            remaining = reservedBalance.get(owner);
        }
        if (remaining < fixedPrice) {
            return;
        }
        // Submitted even on an occupied out port (destEmpty is computed, as ExtractorBehavior does):
        // the resolver lands the create when that port drains this same tick, so a terminal feeding a
        // belt buys every tick instead of every other one. The spend is reserved here either way — a
        // create that loses its port for the tick only over-reserves this pass, never overspends.
        engine.submitCreate(outPort, itemType, item[outPort] === EMPTY);
        terminal.pendingPrice[row] = fixedPrice;
        terminal.pendingIsNpc[row] = 1;
        reservedBalance.set(owner, remaining - fixedPrice);
    }

    /**
     * A buyer's cached balance, minus whatever this pass has already committed to spend on behalf of
     * its owning player (see `_submitIntents`).
     * @private
     * @param {ComponentDefinition} def
     * @param {object} terminal
     * @param {number} buyerEid
     * @param {Map<number, number>} reservedBalance owning player -> balance remaining this pass
     * @returns {number}
     */
    static _remainingBalance(def, terminal, buyerEid, reservedBalance) {
        const row = def.row(buyerEid);
        const owner = terminal.owner[row];
        if (reservedBalance.has(owner)) {
            return reservedBalance.get(owner);
        }
        return terminal.balance[row];
    }

    /**
     * POST_RESOLVE: a buy terminal whose output resolved records last_output (cosmetic) and, if it
     * had an NPC purchase pending (from _submitNpcPurchase), hands the confirmed purchase off to
     * MarketSimMod.onTick for currency settlement — wasResolvedDest is what confirms it, since a
     * create submitted onto an occupied out port lands only if that port drains the same tick.
     * A sell terminal whose attempted transfer actually landed this tick hands the confirmed trade off
     * to MarketSimMod.onTick the same way (an NPC drain always lands once submitted — no counterpart
     * contention — a real transfer may lose the engine's fan-in arbitration to a different seller
     * targeting the same buyer, so it alone needs the resolution check).
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _finish(engine) {
        const def = engine.components.get("MarketTerminal");
        const terminal = def.store;
        const eids = def.eids;
        const book = engine.resolve(MarketBook);
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            if (terminal.mode[row] === MARKET_MODE_BUY) {
                if (engine.wasResolvedDest(terminal.out[row])) {
                    terminal.lastOutput[row] = terminal.itemType[row];
                    if (terminal.pendingPrice[row] !== EMPTY) {
                        book.recordPurchase(eids[row], terminal.itemType[row], terminal.pendingPrice[row]);
                    }
                }
                continue;
            }
            if (terminal.pendingPrice[row] === EMPTY) {
                continue;
            }
            const npc = terminal.pendingIsNpc[row] === 1;
            const confirmed = npc || engine.resolvedDestFor(terminal.in[row]) !== EMPTY;
            if (!confirmed) {
                continue;
            }
            const sellerEid = eids[row];
            terminal.lastOutput[row] = terminal.itemType[row];
            let buyerEid = NO_EID;
            if (!npc) {
                buyerEid = terminal.pendingBuyer[row];
            }
            book.recordSettlement(sellerEid, buyerEid, terminal.itemType[row], terminal.pendingPrice[row]);
        }
    }
}
