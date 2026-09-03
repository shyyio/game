import {AbstractClientMod, PlayerAction, HoverTooltip, TooltipSide, HudLayer} from "@spup/sdk/client";
import {PRODUCTION_LOG_SCHEMA, ProductionLogWriter} from "./client/ProductionLogState.js";
import {ProductionLogButtonLayer} from "./client/ProductionLogButtonLayer.js";
import {ProductionLogPanelLayer} from "./client/ProductionLogPanelLayer.js";
import {ItemsDiscoveredEvent} from "./common/events.js";

/**
 * The Production Log mod's client part: the "productionLog" cache namespace, the top-right log
 * button, the log panel with its item tooltip, and the first-production toast.
 */
export class ProductionLogClientMod extends AbstractClientMod {

    constructor() {
        super();
        this._button = null;
        this._logPanel = null;
        this._tooltip = null;
    }

    /**
     * @param {Client} client
     * @returns {void}
     */
    setup(client) {
        client.cache.register("productionLog", PRODUCTION_LOG_SCHEMA, new ProductionLogWriter(client.cache, client.session));
        this._button = new ProductionLogButtonLayer(client.app);
        // Over the panel the hovered cell sits in, unlike a tooltip beside a world point.
        this._tooltip = new HoverTooltip(client.app, TooltipSide.BELOW, HudLayer.POPOVER);
        this._logPanel = new ProductionLogPanelLayer(client.app, client.cache, client.modRegistry, this._tooltip);
        this._logPanel.anchorButton = this._button;
        this._button.onPress(() => this._logPanel.toggle());
    }

    /**
     * @param {Client} client
     * @returns {Container[]}
     */
    hudLayers(client) {
        return [this._button, this._logPanel, this._tooltip];
    }

    /**
     * @param {number} playerId
     * @param {Client} client
     * @returns {PlayerAction[]}
     */
    playerActions(playerId, client) {
        return [new PlayerAction("View log", () => this._logPanel.showFor(playerId))];
    }

    /**
     * Toasts a first production and refreshes the own log if it is open.
     * @param {AbstractEvent} event
     * @param {Client} client
     * @returns {void}
     */
    onEvent(event, client) {
        if (!(event instanceof ItemsDiscoveredEvent)) {
            return;
        }
        client.hud.notify(this._discoveryText(event.itemTypes, client.modRegistry.items));
        this._logPanel.refreshOwn();
    }

    /**
     * @private
     * @param {number[]} itemTypes
     * @param {ItemRegistry} items
     * @returns {string}
     */
    _discoveryText(itemTypes, items) {
        if (itemTypes.length === 1) {
            return `New item: ${items.require(itemTypes[0]).name}`;
        }
        return `${itemTypes.length} new items`;
    }
}
