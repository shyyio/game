import {AbstractClientMod, CounterEntry} from "@spup/sdk/client";
import {MARKET_SETTING_BALANCE} from "./common/constants.js";
import {MARKET_SCHEMA, MarketWriter} from "./client/MarketState.js";
import {drawCoinIcon, COIN_COLOR} from "./client/icons.js";
import {TradingTerminalConfigLayer} from "./client/TradingTerminalConfigLayer.js";

// This mod's row in the core counter list.
const BALANCE_COUNTER = "marketBalance";
const BALANCE_ENTRY = new CounterEntry(drawCoinIcon, COIN_COLOR, "Credits");

/**
 * The Market mod's client part: the "market" cache namespace, the balance counter, and the
 * screen-space config panel, contributed via the generic hudLayers() hook (mounted on app.stage,
 * not the world viewport).
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
        client.cache.subscribe("playerSettings.values", (key, value) => {
            if (key !== MARKET_SETTING_BALANCE) {
                return;
            }
            if (value === undefined) {
                client.hud.counterListLayer.removeCounter(BALANCE_COUNTER);
                return;
            }
            client.hud.counterListLayer.setCounter(BALANCE_COUNTER, BALANCE_ENTRY, value);
        });
        const balance = client.cache.view("playerSettings").get(MARKET_SETTING_BALANCE);
        if (balance !== undefined) {
            client.hud.counterListLayer.setCounter(BALANCE_COUNTER, BALANCE_ENTRY, balance);
        }
    }

    /**
     * @param {Client} client
     * @returns {Container[]}
     */
    hudLayers(client) {
        return [this._configLayer];
    }
}
