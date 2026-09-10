import {AbstractBehavior, EMPTY, NO_EID, PLAYER_REF_NONE, SyncedFieldSet, SyncedField, AbstractSystem, AbstractComponent, FieldDefinition} from "@spup/sdk";
import {MARKET_MODE_SELL, MARKET_MODE_BUY} from "../common/constants.js";
import {MarketBook} from "./MarketBook.js";

/**
 * A trading terminal: its mode, listing, ports and the per-tick market scratch.
 */
class MarketTerminalComponent extends AbstractComponent {

    constructor() {
        super("MarketTerminal", [
            new FieldDefinition("mode"),
            new FieldDefinition("itemTypeId", "item", EMPTY),
            new FieldDefinition("price"),
            // Buy only: cached owner balance, refreshed per tick by MarketSimMod.onTick. Not authoritative.
            new FieldDefinition("balance"),
            // Buy only: cached chunk owner, lets _submitIntents pool balance across a player's buy terminals.
            new FieldDefinition("owner", "i32", PLAYER_REF_NONE),
            // Sell only: whether this terminal's chunk is owned, refreshed per tick by MarketSimMod.onTick.
            new FieldDefinition("sellEnabled"),
            // Sell-only scratch: price/counterparty this row is selling to this tick.
            new FieldDefinition("pendingPrice", "i32", EMPTY),
            new FieldDefinition("pendingBuyer", "eid", NO_EID),
            new FieldDefinition("pendingIsNpc", "i32", 0),
            new FieldDefinition("inputPort", "eid", NO_EID),
            new FieldDefinition("outputPort", "eid", NO_EID),
            new FieldDefinition("lastOutput", "item", EMPTY),
        ], {isSparse: true});
    }
}

const SYNCED_FIELDS = new SyncedFieldSet("MarketTerminal", [new SyncedField("lastOutput", EMPTY)]);

/**
 * Ticks every trading terminal.
 */
class TradingTerminalSystem extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        super();
        this.engine = engine;
    }

    submitIntents() {
        TradingTerminalBehavior._submitIntents(this.engine);
    }

    postResolve() {
        TradingTerminalBehavior._finish(this.engine);
    }
}

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

    get syncedFields() {
        return SYNCED_FIELDS;
    }

    install(engine) {
        const fixedPrices = new Map();
        for (const listing of engine.modRegistry.marketListings) {
            if (listing.npcPrice !== null) {
                fixedPrices.set(listing.itemTypeId, listing.npcPrice);
            }
        }
        engine.provide(MarketBook, new MarketBook(fixedPrices));
        engine.components.register(new MarketTerminalComponent());
        engine.registerSystem(new TradingTerminalSystem(engine));
    }

    onSpawn(engine, eid, type, message) {
        const terminals = engine.components.getComponentByName("MarketTerminal");
        terminals.attach(eid);
        const terminal = terminals.store;
        const row = terminals.getRowByEid(eid);
        terminal.inputPort[row] = engine.getPortAt(type.inputPorts[0], message.x, message.y, message.direction).port;
        const output = engine.getPortAt(type.outputPorts[0], message.x, message.y, message.direction);
        terminal.outputPort[row] = output.port;
        engine.portItems.addOutputPort(output.port, output.tile.x, output.tile.y);
    }

    onDespawn(engine, eid) {
        const terminals = engine.components.getComponentByName("MarketTerminal");
        const row = terminals.getRowByEid(eid);
        engine.portItems.removeOutputPort(terminals.store.outputPort[row]);
        const book = engine.resolve(MarketBook);
        book.removeBuy(eid);
        book.removeSell(eid);
    }

    /**
     * Records the traded item as the terminal's last output, syncing a change.
     * @private
     * @param {GameEngine} engine
     * @param {MarketTerminalComponent} terminals
     * @param {number} row
     * @returns {void}
     */
    static _setLastOutput(engine, terminals, row) {
        const terminal = terminals.store;
        if (terminal.lastOutput[row] === terminal.itemTypeId[row]) {
            return;
        }
        terminal.lastOutput[row] = terminal.itemTypeId[row];
        engine.sync.markDirty(terminals, terminals.eids[row]);
    }

    getRenderedPortEids(engine, eid) {
        const terminals = engine.components.getComponentByName("MarketTerminal");
        return [terminals.store.outputPort[terminals.getRowByEid(eid)]];
    }

    resyncRenderedPorts(engine, eid) {
        const terminals = engine.components.getComponentByName("MarketTerminal");
        const out = terminals.store.outputPort[terminals.getRowByEid(eid)];
        engine.portItems.addOutputPort(out, engine.Position.x[out], engine.Position.y[out]);
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
     * by owning player: a player with several buy terminals shares one
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
        const terminals = engine.components.getComponentByName("MarketTerminal");
        const terminal = terminals.store;
        const book = engine.resolve(MarketBook);
        const count = terminals.count;
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
            const inputPort = terminal.inputPort[row];
            if (item[inputPort] !== terminal.itemTypeId[row]) {
                continue;
            }
            const match = book.getBestEligibleBuyerOrNull(
                terminal.itemTypeId[row],
                terminal.price[row],
                port => item[port] === EMPTY,
                buyerEid => TradingTerminalBehavior._getRemainingBalance(terminals, terminal, buyerEid, reservedBalance),
            );
            if (match === null) {
                continue;
            }
            terminal.pendingPrice[row] = match.price;
            if (match.isNpc) {
                engine.transfers.submitDrain(inputPort);
                terminal.pendingIsNpc[row] = 1;
            } else {
                engine.transfers.submitTransfer(inputPort, match.outputPort, true, EMPTY, terminal.itemTypeId[row]);
                terminal.pendingBuyer[row] = match.eid;
                const owner = terminal.owner[terminals.getRowByEid(match.eid)];
                const remaining = TradingTerminalBehavior._getRemainingBalance(terminals, terminal, match.eid, reservedBalance);
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
        const itemTypeId = terminal.itemTypeId[row];
        const fixedPrice = book.getFixedPriceByItemTypeIdOrNull(itemTypeId);
        if (fixedPrice === null) {
            return;
        }
        const outputPort = terminal.outputPort[row];
        const owner = terminal.owner[row];
        let remaining = terminal.balance[row];
        if (reservedBalance.has(owner)) {
            remaining = reservedBalance.get(owner);
        }
        if (remaining < fixedPrice) {
            return;
        }
        // Submitted even on an occupied output port (destEmpty is computed, as ExtractorBehavior does):
        // the resolver lands the create when that port drains this same tick, so a terminal feeding a
        // belt buys every tick instead of every other one. The spend is reserved here either way — a
        // create that loses its port for the tick only over-reserves this pass, never overspends.
        engine.transfers.submitCreate(outputPort, itemTypeId, item[outputPort] === EMPTY);
        terminal.pendingPrice[row] = fixedPrice;
        terminal.pendingIsNpc[row] = 1;
        reservedBalance.set(owner, remaining - fixedPrice);
    }

    /**
     * A buyer's cached balance, minus whatever this pass has already committed to spend on behalf of
     * its owning player (see `_submitIntents`).
     * @private
     * @param {MarketTerminalComponent} terminals
     * @param {object} terminal
     * @param {number} buyerEid
     * @param {Map<number, number>} reservedBalance owning player -> balance remaining this pass
     * @returns {number}
     */
    static _getRemainingBalance(terminals, terminal, buyerEid, reservedBalance) {
        const row = terminals.getRowByEid(buyerEid);
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
     * create submitted onto an occupied output port lands only if that port drains the same tick.
     * A sell terminal whose attempted transfer actually landed this tick hands the confirmed trade off
     * to MarketSimMod.onTick the same way (an NPC drain always lands once submitted — no counterpart
     * contention — a real transfer may lose the engine's fan-in arbitration to a different seller
     * targeting the same buyer, so it alone needs the resolution check).
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _finish(engine) {
        const terminals = engine.components.getComponentByName("MarketTerminal");
        const terminal = terminals.store;
        const eids = terminals.eids;
        const book = engine.resolve(MarketBook);
        const count = terminals.count;
        for (let row = 0; row < count; row += 1) {
            if (terminal.mode[row] === MARKET_MODE_BUY) {
                if (engine.transfers.isDest(terminal.outputPort[row])) {
                    TradingTerminalBehavior._setLastOutput(engine, terminals, row);
                    if (terminal.pendingPrice[row] !== EMPTY) {
                        book.addPurchase(eids[row], terminal.itemTypeId[row], terminal.pendingPrice[row]);
                    }
                }
                continue;
            }
            if (terminal.pendingPrice[row] === EMPTY) {
                continue;
            }
            const npc = terminal.pendingIsNpc[row] === 1;
            const confirmed = npc || engine.transfers.getDestByPortEid(terminal.inputPort[row]) !== EMPTY;
            if (!confirmed) {
                continue;
            }
            const sellerEid = eids[row];
            TradingTerminalBehavior._setLastOutput(engine, terminals, row);
            let buyerEid = NO_EID;
            if (!npc) {
                buyerEid = terminal.pendingBuyer[row];
            }
            book.addSettlement(sellerEid, buyerEid, terminal.itemTypeId[row], terminal.pendingPrice[row]);
        }
    }
}
