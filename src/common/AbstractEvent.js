import {AbstractWireObject} from "@/common/AbstractWireObject.js";
import {NotImplementedError} from "@/common/error.js";

/**
 * Position-less base for events the game emits to a session, reusing the `wireFields` contract.
 * @abstract
 */
export class AbstractEvent extends AbstractWireObject {

    /**
     * The sessions subscribed to this event's topic, or undefined when none. Each subclass picks the
     * topic map it routes through, keeping routing off string keys.
     * @param {EventBus} bus
     * @returns {Set<number>|undefined}
     */
    subscribersIn(bus) {
        throw new NotImplementedError();
    }
}
