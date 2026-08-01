import {AbstractBehavior, EMPTY, NO_EID, TickPhase} from "@/sdk/common.js";
import {PLAYER_ID_NONE} from "@/common/constants.js";
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
        engine.provide(MarketBook, new MarketBook());
        engine.defineComponent("MarketTerminal", [
            {name: "mode"},
            {name: "itemType", fill: EMPTY},
            {name: "price"},
            // Buy only: cached owner balance, refreshed per tick by MarketSimMod.onTick. Not authoritative.
            {name: "balance"},
            // Buy only: cached chunk owner, refreshed alongside balance; lets _submitIntents pool
            // balance across a player's several buy terminals within a single tick's matching pass.
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
        const def = engine.component("MarketTerminal");
        engine.attachComponent(def, eid);
        const terminal = def.store;
        const row = def.row(eid);
        terminal.in[row] = engine.portFor(type.inputPorts[0], message.x, message.y, message.direction).port;
        const output = engine.portFor(type.outputPorts[0], message.x, message.y, message.direction);
        terminal.out[row] = output.port;
        engine.registerRenderedPort(output.port, output.tile.x, output.tile.y);
    }

    onDespawn(engine, placed, eid) {
        const def = engine.component("MarketTerminal");
        const row = def.row(eid);
        engine.unregisterRenderedPort(def.store.out[row]);
        const book = engine.resolve(MarketBook);
        book.removeBuy(eid);
        book.removeSell(eid);
    }

    syncData(engine, placed, eid) {
        const def = engine.component("MarketTerminal");
        const row = def.row(eid);
        const last = def.store.lastOutput[row];
        let lastOutput = last;
        if (last === EMPTY) {
            lastOutput = null;
        }
        return {portIds: [def.store.out[row]], lastOutput};
    }

    resyncRenderedPorts(engine, placed, eid) {
        const def = engine.component("MarketTerminal");
        const out = def.store.out[def.row(eid)];
        engine.registerRenderedPort(out, engine.Position.x[out], engine.Position.y[out]);
    }

    /**
     * SUBMIT_INTENTS: a sell terminal armed with a live match submits exactly one transfer straight
     * into its chosen buyer's output port (or a plain drain for an NPC counterparty); a buy terminal
     * submits nothing itself — it only ever receives via a seller's transfer landing in its own
     * output port.
     *
     * `reservedBalance` tracks each buyer's remaining cached balance across this single pass, keyed
     * by owning player rather than by terminal eid: a player with several buy terminals shares one
     * balance, and submitting a match against one of their terminals must reduce what any of their
     * other terminals appear to have left, or the same tick-stale balance would clear every one of
     * them independently and let a multi-terminal player spend past their real balance.
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _submitIntents(engine) {
        const item = engine.Port.item;
        const def = engine.component("MarketTerminal");
        const terminal = def.store;
        const book = engine.resolve(MarketBook);
        const count = def.count;
        const reservedBalance = new Map();
        for (let row = 0; row < count; row += 1) {
            terminal.pendingPrice[row] = EMPTY;
            terminal.pendingBuyer[row] = NO_EID;
            terminal.pendingIsNpc[row] = 0;
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
                engine.submitTransfer(inPort, match.outPort, true, true, -match.price, terminal.itemType[row]);
                terminal.pendingBuyer[row] = match.eid;
                const owner = terminal.owner[def.row(match.eid)];
                const remaining = TradingTerminalBehavior._remainingBalance(def, terminal, match.eid, reservedBalance);
                reservedBalance.set(owner, remaining - match.price);
            }
        }
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
     * POST_RESOLVE: a buy terminal whose output resolved records last_output (cosmetic); a sell
     * terminal whose attempted transfer actually landed this tick hands the confirmed trade off to
     * MarketSimMod.onTick for currency settlement (an NPC drain always lands once submitted — no
     * counterpart contention — a real transfer may lose the engine's fan-in arbitration to a
     * different seller targeting the same buyer, so it alone needs the resolution check).
     * @private
     * @param {GameEngine} engine
     * @returns {void}
     */
    static _finish(engine) {
        const def = engine.component("MarketTerminal");
        const terminal = def.store;
        const eids = def.eids;
        const book = engine.resolve(MarketBook);
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            if (terminal.mode[row] === MARKET_MODE_BUY && engine.wasResolvedDest(terminal.out[row])) {
                terminal.lastOutput[row] = terminal.itemType[row];
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
