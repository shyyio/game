import {WorkerAssignmentEvent, WorkerAssignmentSyncEvent, NO_HOUSING} from "@/common/WorkerEvents.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap} from "@/client/state/ClientCache.js";

export const WORKER_ASSIGNMENTS_SCHEMA = {
    byMachine: schemaMap(),
};

/**
 * @typedef {object} WorkerAssignmentState
 * @property {number} machineId
 * @property {number} housingId
 * @property {number} workers
 * @property {boolean} synced whether the value arrived via a chunk sync
 */

/**
 * Writes machine staffing from the sim's assignment events; attached 0 drops the machine.
 */
export class WorkerAssignmentsWriter extends AbstractCacheWriter {

    /**
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (!(event instanceof WorkerAssignmentEvent)) {
            return;
        }
        if (event.attached === 0) {
            this._state.mapDelete("workerAssignments.byMachine", event.machineId);
            return;
        }
        this._state.mapSet("workerAssignments.byMachine", event.machineId, {
            machineId: event.machineId,
            housingId: event.housingId,
            workers: event.workers,
            synced: event instanceof WorkerAssignmentSyncEvent,
        });
    }
}

/**
 * Derived reads over the workerAssignments namespace.
 */
export class WorkerAssignmentsView extends AbstractCacheView {

    /**
     * @param {number} machineId
     * @returns {WorkerAssignmentState|undefined}
     */
    get(machineId) {
        return this._state.mapGet("workerAssignments.byMachine", machineId);
    }

    /**
     * @returns {IterableIterator<[number, WorkerAssignmentState]>}
     */
    entries() {
        return this._state.mapEntries("workerAssignments.byMachine");
    }

    /**
     * @param {WorkerAssignmentState} assignment
     * @returns {boolean}
     */
    static manned(assignment) {
        return assignment.housingId !== NO_HOUSING;
    }
}
