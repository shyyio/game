import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * Base for events every connected session receives (small global state: claims, the player
 * directory), regardless of chunk or object subscriptions.
 * @abstract
 */
export class AbstractBroadcastEvent extends AbstractEvent {

    /**
     * @param {EventBus} bus
     * @returns {Iterable<number>}
     */
    subscribersIn(bus) {
        return bus.allSessionIds();
    }
}
