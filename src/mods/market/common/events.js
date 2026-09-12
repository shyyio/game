import {AbstractEvent, AbstractChunkRoutedEvent, AbstractBatchEvent} from "@spup/sdk";

// Sentinel for "not applicable" in the snapshot's parallel arrays.
export const MARKET_SNAPSHOT_NONE = -1;

/**
 * Tradable catalog plus the requesting terminal's own configuration; targeted at requester only.
 */
export class MarketSnapshotEvent extends AbstractEvent {

    static wireFields = {
        itemTypeIds: "int32[]",
        npcPrices: "int32[]",
        bestBidPrices: "int32[]",
        bestAskPrices: "int32[]",
        guidePrices: "int32[]",
        currentMode: "int32",
        currentItemTypeId: "int32",
        currentPrice: "int32",
    };

    /**
     * @param {number[]} itemTypeIds
     * @param {number[]} npcPrices - MARKET_SNAPSHOT_NONE where the item isn't NPC-priced
     * @param {number[]} bestBidPrices - MARKET_SNAPSHOT_NONE where no buyer is currently posted
     * @param {number[]} bestAskPrices - MARKET_SNAPSHOT_NONE where no seller is currently posted
     * @param {number[]} guidePrices - MARKET_SNAPSHOT_NONE where the item has no guide price yet
     * @param {number} currentMode MARKET_MODE_NONE/SELL/BUY, this terminal's live mode
     * @param {number} currentItemTypeId MARKET_SNAPSHOT_NONE when unconfigured
     * @param {number} currentPrice MARKET_SNAPSHOT_NONE when unconfigured
     */
    constructor(itemTypeIds, npcPrices, bestBidPrices, bestAskPrices, guidePrices, currentMode, currentItemTypeId, currentPrice) {
        super();
        this.itemTypeIds = itemTypeIds;
        this.npcPrices = npcPrices;
        this.bestBidPrices = bestBidPrices;
        this.bestAskPrices = bestAskPrices;
        this.guidePrices = guidePrices;
        this.currentMode = currentMode;
        this.currentItemTypeId = currentItemTypeId;
        this.currentPrice = currentPrice;
    }
}

/**
 * A trade settled at a terminal, moving `amount` credits for its chunk's owner: positive when the
 * terminal sold, negative when it bought.
 */
export class TradeSettledEvent extends AbstractChunkRoutedEvent {

    static wireFields = {
        objectRef: "int64",
        amount: "int32",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} objectRef
     * @param {number} amount
     */
    constructor(x, y, objectRef, amount) {
        super(x, y);
        this.objectRef = objectRef;
        this.amount = amount;
    }
}

/**
 * One chunk's settled trades for a tick: terminal `objectRefs[i]` moved `amounts[i]` credits.
 */
export class TradeSettledBatchEvent extends AbstractBatchEvent {

    static wireFields = {
        objectRefs: "int64[]",
        amounts: "int32[]",
    };

    /**
     * @param {number} x - a terminal position in the batched chunk, routing the batch to that topic
     * @param {number} y
     */
    constructor(x, y) {
        super(x, y);
        this.objectRefs = [];
        this.amounts = [];
    }

    /**
     * @param {number} objectRef
     * @param {number} amount
     * @returns {void}
     */
    add(objectRef, amount) {
        this.objectRefs.push(objectRef);
        this.amounts.push(amount);
    }

    /**
     * @returns {TradeSettledEvent[]}
     */
    explode() {
        const events = [];
        for (let i = 0; i < this.objectRefs.length; i += 1) {
            events.push(new TradeSettledEvent(this.x, this.y, this.objectRefs[i], this.amounts[i]));
        }
        return events;
    }
}
