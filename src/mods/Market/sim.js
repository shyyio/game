import {AbstractSimMod, chunkId, NO_EID, PLAYER_ID_NONE, PlayerSettingsUpdateEvent} from "@/sdk/common.js";
import {MarketBook} from "./sim/MarketBook.js";
import {TradingTerminalType} from "./common/objectTypes.js";
import {ConfigureTradingTerminalMessage, MarketSnapshotRequestMessage} from "./common/messages.js";
import {MarketSnapshotEvent, MARKET_SNAPSHOT_NONE} from "./common/events.js";
import {
    MARKET_MODE_NONE, MARKET_MODE_SELL, MARKET_MODE_BUY, MARKET_SETTING_BALANCE,
    METRICS_FACT_TYPE_TRADE_EXECUTED, METRICS_TRADE_SIDE_SELL, METRICS_TRADE_SIDE_BUY,
} from "./common/constants.js";

/**
 * The Market mod's session/currency layer: configuring a terminal, reporting the tradable catalog,
 * and the per-tick settlement pass (the one place currency and chunk ownership are reachable —
 * TradingTerminalBehavior itself never touches Game). See MarketBook for the matching engine this
 * wraps.
 */
export class MarketSimMod extends AbstractSimMod {

    /**
     * All this mod's ECS content (the MarketTerminal component, its systems, and the engine-scoped
     * MarketBook) is installed by TradingTerminalBehavior.install, since it's shared with the client
     * bundle via the ObjectType — nothing further to register here.
     * @param {GameEngine} sim
     * @returns {void}
     */
    setup(sim) {}

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {boolean}
     */
    onSessionMessage(message, session, game) {
        if (message instanceof ConfigureTradingTerminalMessage) {
            this._configure(message, game);
            return true;
        }
        if (message instanceof MarketSnapshotRequestMessage) {
            this._sendSnapshot(message, session, game);
            return true;
        }
        return false;
    }

    /**
     * Settles trades/purchases, refreshes buy-terminal balances, advances guide-price clock.
     * @param {Game} game
     * @returns {void}
     */
    onTick(game) {
        const engine = game.simEngine;
        const book = engine.resolve(MarketBook);
        // Shared across both passes: one chunk-owner lookup per terminal, not two.
        const owners = new Map();
        this._settle(book, engine, game, owners);
        this._settlePurchases(book, engine, game, owners);
        this._refreshBalances(engine, game, owners);
        book.advanceTick();
    }

    /**
     * Applies a configure request: shape was already validated on the wire; here we reject an
     * unknown target/item or a non-positive price on a player-market item (an NPC item's price is
     * fixed and ignored), then write the terminal's live quote and (re)post it to the book.
     * @param {ConfigureTradingTerminalMessage} message
     * @param {Game} game
     * @private
     * @returns {void}
     */
    _configure(message, game) {
        const engine = game.simEngine;
        const eid = engine.placed.eidByObjectId(message.objectId);
        if (eid === undefined || engine.placed.typeIdOf(eid) !== TradingTerminalType.typeId) {
            return;
        }
        if (message.mode !== MARKET_MODE_SELL && message.mode !== MARKET_MODE_BUY) {
            return;
        }
        const book = engine.resolve(MarketBook);
        const isFixed = book.isFixedPrice(message.itemType);
        if (!isFixed && message.price <= 0) {
            return;
        }
        const def = engine.component("MarketTerminal");
        const terminal = def.store;
        const row = def.row(eid);
        book.removeBuy(eid);
        book.removeSell(eid);
        terminal.mode[row] = message.mode;
        terminal.itemType[row] = message.itemType;
        if (isFixed) {
            terminal.price[row] = book.fixedPriceOf(message.itemType);
            return;
        }
        terminal.price[row] = message.price;
        if (message.mode === MARKET_MODE_SELL) {
            book.postSell(eid, message.itemType, message.price);
        } else {
            book.postBuy(eid, message.itemType, message.price, terminal.out[row]);
        }
    }

    /**
     * Publishes the tradable catalog (NPC + player-market items) and the requesting terminal's own
     * current configuration, directly to the requesting session.
     * @param {MarketSnapshotRequestMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     * @returns {void}
     */
    _sendSnapshot(message, session, game) {
        const engine = game.simEngine;
        const book = engine.resolve(MarketBook);
        const itemTypes = [];
        const npcPrices = [];
        const bestBidPrices = [];
        const bestAskPrices = [];
        const guidePrices = [];
        for (const listing of engine.modRegistry.marketListings) {
            const itemType = listing.itemType;
            itemTypes.push(itemType);
            const npcPrice = book.fixedPriceOf(itemType);
            const npcSnapshot = npcPrice === undefined ? MARKET_SNAPSHOT_NONE : npcPrice;
            npcPrices.push(npcSnapshot);
            const bestBid = book.bestBid(itemType);
            const bestBidSnapshot = bestBid === undefined ? MARKET_SNAPSHOT_NONE : bestBid;
            bestBidPrices.push(bestBidSnapshot);
            const bestAsk = book.bestAsk(itemType);
            const bestAskSnapshot = bestAsk === undefined ? MARKET_SNAPSHOT_NONE : bestAsk;
            bestAskPrices.push(bestAskSnapshot);
            const guidePrice = book.guidePriceOf(itemType);
            const guideSnapshot = guidePrice === undefined ? MARKET_SNAPSHOT_NONE : guidePrice;
            guidePrices.push(guideSnapshot);
        }

        let currentMode = MARKET_MODE_NONE;
        let currentItemType = MARKET_SNAPSHOT_NONE;
        let currentPrice = MARKET_SNAPSHOT_NONE;
        const eid = engine.placed.eidByObjectId(message.objectId);
        if (eid !== undefined && engine.placed.typeIdOf(eid) === TradingTerminalType.typeId) {
            const def = engine.component("MarketTerminal");
            const terminal = def.store;
            const row = def.row(eid);
            currentMode = terminal.mode[row];
            if (currentMode !== MARKET_MODE_NONE) {
                currentItemType = terminal.itemType[row];
                currentPrice = terminal.price[row];
            }
        }

        game.bus.publishTo(session.id, new MarketSnapshotEvent(
            itemTypes, npcPrices, bestBidPrices, bestAskPrices, guidePrices,
            currentMode, currentItemType, currentPrice,
        ));
    }

    /**
     * @param {number} eid a placed terminal
     * @param {GameEngine} engine
     * @param {Game} game
     * @param {Map<number, number>} owners this tick's eid -> playerId cache, shared across both
     *     _settle and _refreshBalances so a terminal touched by both is only looked up once
     * @private
     * @returns {number} the chunk owner's playerId, or PLAYER_ID_NONE
     */
    _ownerOf(eid, engine, game, owners) {
        let owner = owners.get(eid);
        if (owner === undefined) {
            const position = engine.Position;
            owner = game.claims.ownerOf(chunkId(position.x[eid], position.y[eid]));
            owners.set(eid, owner);
        }
        return owner;
    }

    /**
     * Pays out this tick's confirmed trades: the seller is always credited (their item is already
     * gone); a real (non-NPC) buyer is debited. Both sides settle against their chunk's current
     * owner — an unclaimed chunk has nobody to pay, so that side of the trade is simply skipped
     * rather than left to error. Deltas are batched per player so a player with several terminals
     * confirming in the same tick gets one balance update, not one per trade.
     * @param {MarketBook} book
     * @param {GameEngine} engine
     * @param {Game} game
     * @param {Map<number, number>} owners this tick's eid -> playerId cache
     * @private
     * @returns {void}
     */
    _settle(book, engine, game, owners) {
        const settlements = book.drainSettlements();
        if (settlements.length === 0) {
            return;
        }
        const deltas = new Map();
        for (const settlement of settlements) {
            const sellerOwner = this._ownerOf(settlement.sellerEid, engine, game, owners);
            if (sellerOwner !== PLAYER_ID_NONE) {
                deltas.set(sellerOwner, (deltas.get(sellerOwner) || 0) + settlement.price);
                engine.emitMetrics(
                    METRICS_FACT_TYPE_TRADE_EXECUTED, sellerOwner,
                    settlement.itemType, settlement.price, METRICS_TRADE_SIDE_SELL,
                );
            }
            if (settlement.buyerEid !== NO_EID) {
                const buyerOwner = this._ownerOf(settlement.buyerEid, engine, game, owners);
                if (buyerOwner !== PLAYER_ID_NONE) {
                    deltas.set(buyerOwner, (deltas.get(buyerOwner) || 0) - settlement.price);
                    engine.emitMetrics(
                        METRICS_FACT_TYPE_TRADE_EXECUTED, buyerOwner,
                        settlement.itemType, settlement.price, METRICS_TRADE_SIDE_BUY,
                    );
                }
            }
        }
        for (const [playerId, delta] of deltas) {
            const current = game.playerSettings.get(playerId, MARKET_SETTING_BALANCE) || 0;
            const next = Math.max(0, current + delta);
            game.playerSettings.set(playerId, MARKET_SETTING_BALANCE, next);
            game.bus.publishToPlayer(playerId, new PlayerSettingsUpdateEvent(MARKET_SETTING_BALANCE, next));
        }
    }

    /**
     * Pays out this tick's confirmed NPC purchases: the buyer is debited against its chunk's current
     * owner (an unclaimed chunk has nobody to charge, so the purchase is simply skipped rather than
     * left to error — reachable when the chunk was unclaimed after this terminal's cached owner/balance
     * were last refreshed, since that cache is a tick stale). Deltas are batched per player, same as
     * _settle.
     * @param {MarketBook} book
     * @param {GameEngine} engine
     * @param {Game} game
     * @param {Map<number, number>} owners this tick's eid -> playerId cache
     * @private
     * @returns {void}
     */
    _settlePurchases(book, engine, game, owners) {
        const purchases = book.drainPurchases();
        if (purchases.length === 0) {
            return;
        }
        const deltas = new Map();
        for (const purchase of purchases) {
            const buyerOwner = this._ownerOf(purchase.buyerEid, engine, game, owners);
            if (buyerOwner !== PLAYER_ID_NONE) {
                deltas.set(buyerOwner, (deltas.get(buyerOwner) || 0) - purchase.price);
                engine.emitMetrics(
                    METRICS_FACT_TYPE_TRADE_EXECUTED, buyerOwner,
                    purchase.itemType, purchase.price, METRICS_TRADE_SIDE_BUY,
                );
            }
        }
        for (const [playerId, delta] of deltas) {
            const current = game.playerSettings.get(playerId, MARKET_SETTING_BALANCE) || 0;
            const next = Math.max(0, current + delta);
            game.playerSettings.set(playerId, MARKET_SETTING_BALANCE, next);
            game.bus.publishToPlayer(playerId, new PlayerSettingsUpdateEvent(MARKET_SETTING_BALANCE, next));
        }
    }

    /**
     * Refreshes every terminal's chunk-ownership-derived cache for next tick's eligibility checks
     * (see TradingTerminalBehavior): a buy terminal's `balance` (from its chunk owner's real
     * balance — an unowned chunk caches 0, so it never wins a match) and a sell terminal's
     * `sellEnabled` (whether its chunk currently has any owner at all — an unclaimed seller must
     * never sell, since nobody could be paid for it).
     * @param {GameEngine} engine
     * @param {Game} game
     * @param {Map<number, number>} owners this tick's eid -> playerId cache
     * @private
     * @returns {void}
     */
    _refreshBalances(engine, game, owners) {
        const def = engine.component("MarketTerminal");
        const terminal = def.store;
        const eids = def.eids;
        const count = def.count;
        for (let row = 0; row < count; row += 1) {
            if (terminal.mode[row] === MARKET_MODE_SELL) {
                const owner = this._ownerOf(eids[row], engine, game, owners);
                if (owner === PLAYER_ID_NONE) {
                    terminal.sellEnabled[row] = 0;
                } else {
                    terminal.sellEnabled[row] = 1;
                }
                continue;
            }
            if (terminal.mode[row] !== MARKET_MODE_BUY) {
                continue;
            }
            const owner = this._ownerOf(eids[row], engine, game, owners);
            let balance = 0;
            if (owner !== PLAYER_ID_NONE) {
                balance = game.playerSettings.get(owner, MARKET_SETTING_BALANCE) || 0;
            }
            terminal.balance[row] = balance;
            terminal.owner[row] = owner;
        }
    }
}
