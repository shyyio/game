import {AbstractEvent} from "@/sdk/common.js";

// Sentinel for "not applicable" in the snapshot's parallel arrays.
export const MARKET_SNAPSHOT_NONE = -1;

/**
 * Tradable catalog plus the requesting terminal's own configuration; targeted at requester only.
 */
export class MarketSnapshotEvent extends AbstractEvent {

    static wireFields = {
        itemTypes: "int32[]",
        npcPrices: "int32[]",
        bestBidPrices: "int32[]",
        bestAskPrices: "int32[]",
        guidePrices: "int32[]",
        currentMode: "int32",
        currentItemType: "int32",
        currentPrice: "int32",
    };

    /**
     * @param {number[]} itemTypes
     * @param {number[]} npcPrices - MARKET_SNAPSHOT_NONE where the item isn't NPC-priced
     * @param {number[]} bestBidPrices - MARKET_SNAPSHOT_NONE where no buyer is currently posted
     * @param {number[]} bestAskPrices - MARKET_SNAPSHOT_NONE where no seller is currently posted
     * @param {number[]} guidePrices - MARKET_SNAPSHOT_NONE where the item has no guide price yet
     * @param {number} currentMode MARKET_MODE_NONE/SELL/BUY, this terminal's live mode
     * @param {number} currentItemType MARKET_SNAPSHOT_NONE when unconfigured
     * @param {number} currentPrice MARKET_SNAPSHOT_NONE when unconfigured
     */
    constructor(itemTypes, npcPrices, bestBidPrices, bestAskPrices, guidePrices, currentMode, currentItemType, currentPrice) {
        super();
        this.itemTypes = itemTypes;
        this.npcPrices = npcPrices;
        this.bestBidPrices = bestBidPrices;
        this.bestAskPrices = bestAskPrices;
        this.guidePrices = guidePrices;
        this.currentMode = currentMode;
        this.currentItemType = currentItemType;
        this.currentPrice = currentPrice;
    }
}
