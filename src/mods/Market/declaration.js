import {AbstractModDeclaration, PlayerSettingEntry, MetricsGlobalQueryEntry} from "@/sdk/common.js";
import {
    MARKET_SETTING_BALANCE, METRICS_FACT_TYPE_TRADE_EXECUTED, METRICS_TRADE_SIDE_SELL,
} from "./common/constants.js";
import {TradingTerminalType} from "./common/objectTypes.js";
import {ConfigureTradingTerminalMessage, MarketSnapshotRequestMessage} from "./common/messages.js";
import {MarketSnapshotEvent} from "./common/events.js";

export class MarketDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "Market";
    }

    get objectTypes() {
        return [TradingTerminalType];
    }

    get wireClasses() {
        return [
            ConfigureTradingTerminalMessage,
            MarketSnapshotRequestMessage,
            MarketSnapshotEvent,
        ];
    }

    get playerSettingEntries() {
        return [
            // optionCount only gates the clientWritable path; irrelevant here (server-authoritative).
            new PlayerSettingEntry(MARKET_SETTING_BALANCE, false, 0),
        ];
    }

    get metricsGlobalQueries() {
        return [
            // SELL rows only, so the public price series doesn't double-count each trade.
            new MetricsGlobalQueryEntry(METRICS_FACT_TYPE_TRADE_EXECUTED, row => row.tag === METRICS_TRADE_SIDE_SELL),
        ];
    }
}
