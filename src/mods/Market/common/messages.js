import {AbstractMessage} from "@/sdk/common.js";

/**
 * Configures a placed terminal's standing quote. `price` is a floor in sell mode, a ceiling in buy
 * mode. Posting/updating a bid never costs anything up front — currency only moves per unit, when a
 * trade actually executes (see TradingTerminalBehavior).
 */
export class ConfigureTradingTerminalMessage extends AbstractMessage {

    static wireFields = {
        objectId: "int32",
        mode: "int32",
        itemType: "int32",
        price: "int32",
    };

    /**
     * @param {number} objectId
     * @param {number} mode MARKET_MODE_SELL or MARKET_MODE_BUY
     * @param {number} itemType
     * @param {number} price
     */
    constructor(objectId, mode, itemType, price) {
        super();
        this.objectId = objectId;
        this.mode = mode;
        this.itemType = itemType;
        this.price = price;
    }

    /**
     * Shape only; unknown item ids and non-positive prices are rejected server-side where the
     * tradable catalog and the terminal actually live.
     * @param {GameAPI} api
     * @param {AbstractSession} session
     * @returns {boolean}
     */
    validate(api, session) {
        return Number.isInteger(this.objectId) && Number.isInteger(this.mode)
            && Number.isInteger(this.itemType) && Number.isInteger(this.price);
    }
}

/**
 * Requests the current market snapshot (fixed/live prices for every tradable item) plus `objectId`'s
 * own current configuration, sent when the config panel opens.
 */
export class MarketSnapshotRequestMessage extends AbstractMessage {

    static wireFields = {
        objectId: "int32",
    };

    /**
     * @param {number} objectId
     */
    constructor(objectId) {
        super();
        this.objectId = objectId;
    }
}
