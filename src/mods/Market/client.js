import {AbstractClientMod} from "@/sdk/client.js";
import {MARKET_SCHEMA, MarketWriter} from "./client/MarketState.js";
import {TradingTerminalConfigLayer} from "./client/TradingTerminalConfigLayer.js";

/**
 * The Market mod's client part: the "market" cache namespace and its screen-space config panel,
 * contributed via the generic hudLayers() hook (mounted on app.stage, not the world viewport).
 */
export class MarketClientMod extends AbstractClientMod {

    constructor() {
        super();
        this._configLayer = null;
    }

    /**
     * @param {Client} client
     * @returns {void}
     */
    setup(client) {
        client.cache.register("market", MARKET_SCHEMA, new MarketWriter(client.cache, client.session));
        this._configLayer = new TradingTerminalConfigLayer(client.app, client.cache, client.session, client.modRegistry.items);
    }

    /**
     * @param {Client} client
     * @returns {Container[]}
     */
    hudLayers(client) {
        return [this._configLayer];
    }
}
