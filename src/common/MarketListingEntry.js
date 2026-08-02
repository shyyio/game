/**
 * One item type's tradable-catalog listing, collected at ModRegistry.freeze() from every mod's
 * declaration.marketListings. Never wired.
 */
export class MarketListingEntry {

    /**
     * @param {number} itemType
     * @param {number|null} npcPrice fixed NPC price, or null for a player-market-only item
     */
    constructor(itemType, npcPrice) {
        this.itemType = itemType;
        this.npcPrice = npcPrice;
    }
}
