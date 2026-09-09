/**
 * One item type's tradable-catalog listing, collected at ModRegistry.freeze() from every mod's
 * declaration.marketListings. Never wired.
 */
export class MarketListingEntry {

    /**
     * @param {number} itemTypeId
     * @param {number|null} npcPrice fixed NPC price, or null for a player-market-only item
     */
    constructor(itemTypeId, npcPrice) {
        this.itemTypeId = itemTypeId;
        this.npcPrice = npcPrice;
    }
}
