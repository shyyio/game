import {AbstractMessage} from "@spup/sdk";

/**
 * Configures a placed terminal's standing quote. `price` is a floor in sell mode, a ceiling in buy
 * mode. Posting/updating a bid never costs anything up front — currency only moves per unit, when a
 * trade actually executes (see TradingTerminalBehavior).
 */
export class ConfigureTradingTerminalMessage extends AbstractMessage {

    static wireFields = {
        objectRef: "int32",
        mode: "int32",
        itemTypeId: "int32",
        price: "int32",
    };

    /**
     * @param {number} objectRef
     * @param {number} mode MARKET_MODE_SELL or MARKET_MODE_BUY
     * @param {number} itemTypeId
     * @param {number} price
     */
    constructor(objectRef, mode, itemTypeId, price) {
        super();
        this.objectRef = objectRef;
        this.mode = mode;
        this.itemTypeId = itemTypeId;
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
        return Number.isInteger(this.objectRef) && Number.isInteger(this.mode)
            && Number.isInteger(this.itemTypeId) && Number.isInteger(this.price);
    }
}

/**
 * Requests the current market snapshot (fixed/live prices for every tradable item) plus `objectRef`'s
 * own current configuration, sent when the config panel opens.
 */
export class MarketSnapshotRequestMessage extends AbstractMessage {

    static wireFields = {
        objectRef: "int32",
    };

    /**
     * @param {number} objectRef
     */
    constructor(objectRef) {
        super();
        this.objectRef = objectRef;
    }
}
