import {AbstractModDeclaration} from "@spup/sdk";
import {
    ProductionLogRequestMessage,
    ItemLeaderboardRequestMessage,
} from "./common/messages.js";
import {
    ItemsDiscoveredEvent,
    ProductionLogEvent,
    ItemLeaderboardEvent,
} from "./common/events.js";

export class ProductionLogDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "ProductionLog";
    }

    get wireClasses() {
        return [
            ProductionLogRequestMessage,
            ItemLeaderboardRequestMessage,
            ItemsDiscoveredEvent,
            ProductionLogEvent,
            ItemLeaderboardEvent,
        ];
    }
}
