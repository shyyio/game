import {AbstractClientMod, CounterEntry} from "@spup/sdk/client";
import {MARKET_SETTING_BALANCE} from "./common/constants.js";
import {MARKET_SCHEMA, MarketWriter} from "./client/MarketState.js";
import {drawCoinIcon, COIN_COLOR} from "./client/icons.js";
import {TradingTerminalConfigLayer} from "./client/TradingTerminalConfigLayer.js";
import {formatTradeAmount, getSplatColorByAmount, TRADE_SPLAT_JITTER} from "./client/splats.js";
import {TradeSettledEvent} from "./common/events.js";

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
    init(client) {
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
        const balance = client.cache.view("playerSettings").getValueByKey(MARKET_SETTING_BALANCE);
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

    /**
     * Floats a settled trade's credit movement over the terminal that traded.
     * @param {AbstractEvent} event
     * @param {Client} client
     * @returns {void}
     */
    onEvent(event, client) {
        if (!(event instanceof TradeSettledEvent)) {
            return;
        }
        const entry = client.objects.get(event.objectRef);
        if (entry === null) {
            return;
        }
        client.hitsplatLayer.drawHitsplat({
            tileX: entry.tileX,
            tileY: entry.tileY,
            text: formatTradeAmount(event.amount),
            color: getSplatColorByAmount(event.amount),
            jitter: TRADE_SPLAT_JITTER,
            drawIcon: drawCoinIcon,
            iconColor: COIN_COLOR,
        });
    }
}
