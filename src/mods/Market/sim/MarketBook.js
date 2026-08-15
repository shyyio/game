import {EMPTY} from "@spup/sdk";
import {GUIDE_PRICE_INTERVAL_TICKS, GUIDE_PRICE_MAX_STEP_FRACTION} from "../common/constants.js";

/**
 * One terminal's standing bid, indexed by item type.
 */
class MarketQuote {

    /**
     * @param {number} eid
     * @param {number} itemType
     * @param {number} price
     * @param {number} outPort
     * @param {number} sequence
     */
    constructor(eid, itemType, price, outPort, sequence) {
        this.eid = eid;
        this.itemType = itemType;
        this.price = price;
        this.outPort = outPort;
        this.sequence = sequence;
    }
}

/**
 * One item's guide price and the trade activity accumulated toward its next recompute.
 */
class GuidePrice {

    /**
     * @param {number} price
     */
    constructor(price) {
        this.price = price;
        this.tradeCount = 0;
        this.priceSum = 0;
        this.lastUpdateTick = 0;
    }
}

/**
 * The best current counterparty for a seller, or null when none qualify.
 */
class MarketMatch {

    /**
     * @param {boolean} npc
     * @param {number} price
     * @param {number} eid - NO_EID for an NPC match
     * @param {number} outPort - EMPTY for an NPC match
     */
    constructor(npc, price, eid, outPort) {
        this.npc = npc;
        this.price = price;
        this.eid = eid;
        this.outPort = outPort;
    }
}

/**
 * One confirmed trade, handed off from {@link TradingTerminalBehavior}'s POST_RESOLVE to
 * {@link MarketSimMod}'s onTick for currency settlement.
 */
class MarketSettlement {

    /**
     * @param {number} sellerEid
     * @param {number} buyerEid - NO_EID for an NPC counterparty
     * @param {number} itemType
     * @param {number} price
     */
    constructor(sellerEid, buyerEid, itemType, price) {
        this.sellerEid = sellerEid;
        this.buyerEid = buyerEid;
        this.itemType = itemType;
        this.price = price;
    }
}

/**
 * One confirmed NPC-sourced purchase, handed off from {@link TradingTerminalBehavior}'s
 * POST_RESOLVE to {@link MarketSimMod}'s onTick for currency settlement.
 */
class MarketPurchase {

    /**
     * @param {number} buyerEid
     * @param {number} itemType
     * @param {number} price
     */
    constructor(buyerEid, itemType, price) {
        this.buyerEid = buyerEid;
        this.itemType = itemType;
        this.price = price;
    }
}

/**
 * One side (buy or sell) of the book's standing-quote index: itemType -> quote[] for lookup,
 * eid -> quote for O(1) removal.
 */
class QuoteIndex {

    constructor() {
        this._byItem = new Map();
        this._byEid = new Map();
    }

    /**
     * @param {MarketQuote} quote
     * @returns {void}
     */
    post(quote) {
        this.remove(quote.eid);
        this._byEid.set(quote.eid, quote);
        let quotes = this._byItem.get(quote.itemType);
        if (quotes === undefined) {
            quotes = [];
            this._byItem.set(quote.itemType, quotes);
        }
        quotes.push(quote);
    }

    /**
     * @param {number} eid
     * @returns {void}
     */
    remove(eid) {
        const quote = this._byEid.get(eid);
        if (quote === undefined) {
            return;
        }
        this._byEid.delete(eid);
        const quotes = this._byItem.get(quote.itemType);
        quotes.splice(quotes.indexOf(quote), 1);
        if (quotes.length === 0) {
            this._byItem.delete(quote.itemType);
        }
    }

    /**
     * @param {number} itemType
     * @returns {MarketQuote[]|undefined}
     */
    list(itemType) {
        return this._byItem.get(itemType);
    }

    /**
     * @param {number} itemType
     * @returns {number}
     */
    count(itemType) {
        const quotes = this._byItem.get(itemType);
        if (quotes === undefined) {
            return 0;
        }
        return quotes.length;
    }
}

/**
 * Player market: standing-quote index per item, seller-initiated matching, guide-price tracking,
 * per-tick settlement handoff. Engine-scoped via {@link GameEngine#provide}/{@link GameEngine#resolve}.
 */
export class MarketBook {

    /**
     * @param {Map<number, number>} [fixedPrices] itemType -> NPC price
     * @param {number} [guidePriceIntervalTicks] overridable so tests don't need real-length intervals
     */
    constructor(fixedPrices = new Map(), guidePriceIntervalTicks = GUIDE_PRICE_INTERVAL_TICKS) {
        this._fixedPrices = fixedPrices;
        this._guidePriceIntervalTicks = guidePriceIntervalTicks;
        this._nextSequence = 0;

        // Posted buy quotes.
        this._buys = new QuoteIndex();
        // Posted sell quotes; matching never reads this, only guide-price/best-ask.
        this._sells = new QuoteIndex();

        // This tick's confirmed trades, drained by MarketSimMod.onTick.
        this._settlements = [];
        // This tick's confirmed NPC purchases, drained by MarketSimMod.onTick.
        this._purchases = [];

        // itemType -> GuidePrice.
        this._guidePrices = new Map();
        // Own tick clock; advanced once per onTick call.
        this._tick = 0;
    }

    /**
     * @param {number} itemType
     * @returns {boolean}
     */
    isFixedPrice(itemType) {
        return this._fixedPrices.has(itemType);
    }

    /**
     * @param {number} itemType
     * @returns {number|undefined}
     */
    fixedPriceOf(itemType) {
        return this._fixedPrices.get(itemType);
    }

    /**
     * Posts or replaces a buy terminal's standing bid.
     * @param {number} eid
     * @param {number} itemType
     * @param {number} price
     * @param {number} outPort
     * @returns {void}
     */
    postBuy(eid, itemType, price, outPort) {
        const quote = new MarketQuote(eid, itemType, price, outPort, this._nextSequence);
        this._nextSequence += 1;
        this._buys.post(quote);
    }

    /**
     * Removes a buy terminal's standing bid, if any.
     * @param {number} eid
     * @returns {void}
     */
    removeBuy(eid) {
        this._buys.remove(eid);
    }

    /**
     * Posts or replaces a sell terminal's standing floor. Matching never looks this index up by
     * item — each seller carries its own floor and initiates its own match — this only feeds the
     * guide-price supply signal and the reported best ask.
     * @param {number} eid
     * @param {number} itemType
     * @param {number} price
     * @returns {void}
     */
    postSell(eid, itemType, price) {
        const quote = new MarketQuote(eid, itemType, price, EMPTY, this._nextSequence);
        this._nextSequence += 1;
        this._sells.post(quote);
    }

    /**
     * Removes a sell terminal's standing floor, if any.
     * @param {number} eid
     * @returns {void}
     */
    removeSell(eid) {
        this._sells.remove(eid);
    }

    /**
     * @param {number} itemType
     * @returns {number}
     */
    buyCount(itemType) {
        return this._buys.count(itemType);
    }

    /**
     * @param {number} itemType
     * @returns {number}
     */
    sellCount(itemType) {
        return this._sells.count(itemType);
    }

    /**
     * @param {number} itemType
     * @returns {number|undefined} the highest currently-posted bid, or undefined if none
     */
    bestBid(itemType) {
        const quotes = this._buys.list(itemType);
        if (quotes === undefined || quotes.length === 0) {
            return undefined;
        }
        let best = quotes[0].price;
        for (let i = 1; i < quotes.length; i += 1) {
            best = Math.max(best, quotes[i].price);
        }
        return best;
    }

    /**
     * @param {number} itemType
     * @returns {number|undefined} the lowest currently-posted ask, or undefined if none
     */
    bestAsk(itemType) {
        const quotes = this._sells.list(itemType);
        if (quotes === undefined || quotes.length === 0) {
            return undefined;
        }
        let best = quotes[0].price;
        for (let i = 1; i < quotes.length; i += 1) {
            best = Math.min(best, quotes[i].price);
        }
        return best;
    }

    /**
     * The best current counterparty for a seller asking `floorPrice` for `itemType`: the
     * highest-paying eligible buyer (clears the floor, its output port is currently free, its cached
     * balance covers its own price), preferring a player buyer over the NPC on a tie. Null when
     * nothing qualifies.
     * @param {number} itemType
     * @param {number} floorPrice
     * @param {function(number): boolean} portIsEmpty
     * @param {function(number): number} balanceOf
     * @returns {MarketMatch|null}
     */
    bestEligibleBuyer(itemType, floorPrice, portIsEmpty, balanceOf) {
        let best = null;
        const quotes = this._buys.list(itemType);
        if (quotes !== undefined) {
            for (const quote of quotes) {
                if (quote.price < floorPrice) {
                    continue;
                }
                if (!portIsEmpty(quote.outPort)) {
                    continue;
                }
                if (balanceOf(quote.eid) < quote.price) {
                    continue;
                }
                if (best === null
                    || quote.price > best.price
                    || (quote.price === best.price && quote.sequence < best.sequence)) {
                    best = quote;
                }
            }
        }
        const fixedPrice = this._fixedPrices.get(itemType);
        if (fixedPrice !== undefined && fixedPrice >= floorPrice && (best === null || fixedPrice > best.price)) {
            return new MarketMatch(true, fixedPrice, null, null);
        }
        if (best === null) {
            return null;
        }
        return new MarketMatch(false, best.price, best.eid, best.outPort);
    }

    /**
     * Records a confirmed trade for MarketSimMod.onTick to settle; also feeds the guide-price
     * trade-history signal.
     * @param {number} sellerEid
     * @param {number} buyerEid - NO_EID for an NPC counterparty
     * @param {number} itemType
     * @param {number} price
     * @returns {void}
     */
    recordSettlement(sellerEid, buyerEid, itemType, price) {
        this._settlements.push(new MarketSettlement(sellerEid, buyerEid, itemType, price));
        let guide = this._guidePrices.get(itemType);
        if (guide === undefined) {
            guide = new GuidePrice(price);
            this._guidePrices.set(itemType, guide);
        }
        guide.tradeCount += 1;
        guide.priceSum += price;
    }

    /**
     * Returns and clears this tick's confirmed trades.
     * @returns {MarketSettlement[]}
     */
    drainSettlements() {
        const settlements = this._settlements;
        this._settlements = [];
        return settlements;
    }

    /**
     * Records a confirmed NPC-sourced purchase (a buy terminal creating a fixed-price item straight
     * from the NPC's infinite supply) for MarketSimMod.onTick to settle.
     * @param {number} buyerEid
     * @param {number} itemType
     * @param {number} price
     * @returns {void}
     */
    recordPurchase(buyerEid, itemType, price) {
        this._purchases.push(new MarketPurchase(buyerEid, itemType, price));
    }

    /**
     * Returns and clears this tick's confirmed NPC purchases.
     * @returns {MarketPurchase[]}
     */
    drainPurchases() {
        const purchases = this._purchases;
        this._purchases = [];
        return purchases;
    }

    /**
     * @param {number} itemType
     * @returns {number|undefined} the item's guide price, or undefined if never traded/imbalanced
     */
    guidePriceOf(itemType) {
        const guide = this._guidePrices.get(itemType);
        if (guide === undefined) {
            return undefined;
        }
        return guide.price;
    }

    /**
     * Advances this engine instance's tick clock, recomputing every tracked item's guide price whose
     * interval has elapsed: a bounded nudge toward this interval's average trade price (volume-
     * weighted), plus a bounded nudge for any standing buy/sell count imbalance. Never enforced on
     * trades — a UI default only. Call once per onTick.
     * @returns {void}
     */
    advanceTick() {
        this._tick += 1;
        const tick = this._tick;
        for (const [itemType, guide] of this._guidePrices) {
            if (tick - guide.lastUpdateTick < this._guidePriceIntervalTicks) {
                continue;
            }
            const maxStep = Math.max(1, Math.round(guide.price * GUIDE_PRICE_MAX_STEP_FRACTION));
            let price = guide.price;
            if (guide.tradeCount > 0) {
                const average = guide.priceSum / guide.tradeCount;
                const volumeWeight = Math.min(1, guide.tradeCount / 50);
                const step = Math.round((average - price) * volumeWeight);
                price += Math.max(-maxStep, Math.min(maxStep, step));
            }
            const imbalance = this.buyCount(itemType) - this.sellCount(itemType);
            if (imbalance !== 0) {
                const step = Math.sign(imbalance) * Math.min(maxStep, Math.abs(imbalance));
                price += step;
            }
            guide.price = Math.max(1, price);
            guide.tradeCount = 0;
            guide.priceSum = 0;
            guide.lastUpdateTick = tick;
        }
    }
}
