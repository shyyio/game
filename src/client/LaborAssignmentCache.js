import {NO_HOUSING} from "@/common/LaborEvents.js";

/**
 * One road-attached machine's staffing, mirrored from the sim.
 */
export class LaborAssignment {

    /**
     * @param {number} machineId
     * @param {number} housingId
     * @param {number} workers
     */
    constructor(
        machineId,
        housingId,
        workers,
    ) {
        this.machineId = machineId;
        this.housingId = housingId;
        this.workers = workers;
    }

    /**
     * @returns {boolean}
     */
    get manned() {
        return this.housingId !== NO_HOUSING;
    }
}

/**
 * Client-side index of machine staffing, fed LaborAssignmentEvents once by the client and read by
 * every labor layer (badges, worker figures, debug overlay).
 */
export class LaborAssignmentCache {

    constructor() {
        /**
         * @type {Map<number, LaborAssignment>}
         * @private
         */
        this._assignments = new Map();
        /**
         * @type {Array<function(number): void>}
         * @private
         */
        this._changeListeners = [];
    }

    /**
     * Registers a callback invoked with each machineId whose assignment was set or dropped.
     * @param {function(number): void} listener
     * @returns {void}
     */
    onChange(listener) {
        this._changeListeners.push(listener);
    }

    /**
     * Applies an assignment event; attached 0 drops the machine from the index.
     * @param {LaborAssignmentEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event.attached === 0) {
            this._assignments.delete(event.machineId);
        } else {
            this._assignments.set(
                event.machineId,
                new LaborAssignment(event.machineId, event.housingId, event.workers),
            );
        }
        for (const listener of this._changeListeners) {
            listener(event.machineId);
        }
    }

    /**
     * @param {number} machineId
     * @returns {boolean}
     */
    has(machineId) {
        return this._assignments.has(machineId);
    }

    /**
     * The machine's assignment, or null when it touches no road.
     * @param {number} machineId
     * @returns {LaborAssignment|null}
     */
    get(machineId) {
        const assignment = this._assignments.get(machineId);
        return assignment === undefined ? null : assignment;
    }

    /**
     * @returns {IterableIterator<LaborAssignment>} every tracked assignment
     */
    values() {
        return this._assignments.values();
    }
}
