import {InspectHeartbeatEvent, InspectClosedEvent} from "@/common/InspectEvents.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap, schemaSet} from "@/client/ClientCache.js";

export const INSPECT_SCHEMA = {
    openObjects: schemaSet(),
    heartbeatByObject: schemaMap(),
};

/**
 * @typedef {object} InspectHeartbeatState a machine's latest inspect snapshot, field-for-field
 *     from {@link InspectHeartbeatEvent}
 */

/**
 * Writes the open inspect menus and their per-tick snapshots: opening/closing are local writes
 * (plus the sim-driven close event), the heartbeats ride the wire.
 */
export class InspectWriter extends AbstractCacheWriter {

    /**
     * Local write: opens a machine's menu.
     * @param {number} objectId
     * @returns {void}
     */
    open(objectId) {
        this._state.setAdd("inspect.openObjects", objectId);
    }

    /**
     * Local write: closes a machine's menu; an unknown id is a no-op.
     * @param {number} objectId
     * @returns {void}
     */
    close(objectId) {
        this._state.mapDelete("inspect.heartbeatByObject", objectId);
        this._state.setDelete("inspect.openObjects", objectId);
    }

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event instanceof InspectHeartbeatEvent) {
            // Ignore a heartbeat in flight past a close, so it can't revive a shut panel.
            if (!this._state.setHas("inspect.openObjects", event.objectId)) {
                return;
            }
            this._state.mapSet("inspect.heartbeatByObject", event.objectId, {
                objectId: event.objectId,
                inputPorts: event.inputPorts,
                inputMemory: event.inputMemory,
                processingRemaining: event.processingRemaining,
                processingTotal: event.processingTotal,
                outputItem: event.outputItem,
                recipeOutput: event.recipeOutput,
                workerCost: event.workerCost,
                workers: event.workers,
                workerSupply: event.workerSupply,
                workerDemand: event.workerDemand,
            });
            return;
        }
        if (event instanceof InspectClosedEvent) {
            this.close(event.objectId);
        }
    }
}

/**
 * Derived reads over the inspect namespace.
 */
export class InspectView extends AbstractCacheView {

    /**
     * @returns {number[]} the open machines' object ids
     */
    openIds() {
        return [...this._state.setValues("inspect.openObjects")];
    }

    /**
     * @param {number} objectId
     * @returns {boolean}
     */
    isOpen(objectId) {
        return this._state.setHas("inspect.openObjects", objectId);
    }
}
