import {getOrCreate, removeFromGroup, chunkId} from "@/common/util.js";

/**
 * One road-attached machine's standing worker allocation. `granted` and `housingObjectId` are the
 * allocation's result, filled in as the component's supply is handed out; `supply`/`demand` are its
 * whole component's totals, carried for inspect.
 */
export class WorkerAssignment {

    /**
     * @param {object} config
     * @param {number} config.objectId - the machine
     * @param {number} config.x
     * @param {number} config.y
     * @param {number} config.supply
     * @param {number} config.demand
     * @param {number} config.component
     */
    constructor({objectId, x, y, supply, demand, component}) {
        this.objectId = objectId;
        this.x = x;
        this.y = y;
        this.supply = supply;
        this.demand = demand;
        this.component = component;
        /**
         * The housing the workers come from, null while none are granted.
         * @type {number|null}
         */
        this.housingObjectId = null;
        this.granted = 0;
    }
}

/**
 * Every road-attached machine's assignment, indexed by chunk (so a chunk sync walks only its own)
 * and by road component (so a partial recompute diffs only the components it touched).
 */
export class WorkerAssignments {

    constructor() {
        /**
         * machineObjectId -> assignment.
         * @type {Map<number, WorkerAssignment>}
         * @private
         */
        this._byObjectId = new Map();
        /** @private */
        this._byChunk = new Map();
        /** @private */
        this._byComponent = new Map();
    }

    /**
     * @param {number} objectId
     * @returns {WorkerAssignment|undefined}
     */
    get(objectId) {
        return this._byObjectId.get(objectId);
    }

    /**
     * The chunk's assigned machines, or undefined when it holds none.
     * @param {number} chunk
     * @returns {Set<number>|undefined}
     */
    inChunk(chunk) {
        return this._byChunk.get(chunk);
    }

    /**
     * @param {WorkerAssignment} assignment
     * @returns {void}
     */
    store(assignment) {
        this._byObjectId.set(assignment.objectId, assignment);
        getOrCreate(this._byChunk, chunkId(assignment.x, assignment.y), () => new Set()).add(assignment.objectId);
        getOrCreate(this._byComponent, assignment.component, () => new Set()).add(assignment.objectId);
    }

    /**
     * @param {number} objectId
     * @returns {void}
     */
    drop(objectId) {
        const assignment = this._byObjectId.get(objectId);
        if (assignment === undefined) {
            return;
        }
        this._byObjectId.delete(objectId);
        removeFromGroup(this._byChunk, chunkId(assignment.x, assignment.y), objectId);
        removeFromGroup(this._byComponent, assignment.component, objectId);
    }

    /**
     * The assignments a recompute replaces: all of them when `components` is null, else the given
     * components' share.
     * @param {Set<number>|null} components
     * @returns {Map<number, WorkerAssignment>}
     */
    within(components) {
        if (components === null) {
            return new Map(this._byObjectId);
        }
        const held = new Map();
        for (const component of components) {
            const objectIds = this._byComponent.get(component);
            if (objectIds === undefined) {
                continue;
            }
            for (const objectId of objectIds) {
                held.set(objectId, this._byObjectId.get(objectId));
            }
        }
        return held;
    }

    /**
     * @returns {void}
     */
    clear() {
        this._byObjectId = new Map();
        this._byChunk = new Map();
        this._byComponent = new Map();
    }
}
