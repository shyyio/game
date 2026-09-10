import {getOrCreate, removeFromGroup, chunkKeyAt} from "@/common/util.js";

/**
 * One road-attached machine's standing worker allocation. `granted` and `housingObjectRef` are the
 * allocation's result, filled in as the component's supply is handed out; `supply`/`demand` are its
 * whole component's totals, carried for inspect.
 */
export class WorkerAssignment {

    /**
     * @param {object} config
     * @param {number} config.objectRef - the machine
     * @param {number} config.x
     * @param {number} config.y
     * @param {number} config.supply
     * @param {number} config.demand
     * @param {number} config.component
     */
    constructor({objectRef, x, y, supply, demand, component}) {
        this.objectRef = objectRef;
        this.x = x;
        this.y = y;
        this.supply = supply;
        this.demand = demand;
        this.component = component;
        /**
         * The housing the workers come from, null while none are granted.
         * @type {number|null}
         */
        this.housingObjectRef = null;
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
         * machineObjectRef -> assignment.
         * @type {Map<number, WorkerAssignment>}
         * @private
         */
        this._byObjectRef = new Map();
        /** @private */
        this._byChunk = new Map();
        /** @private */
        this._byComponent = new Map();
    }

    /**
     * @param {number} objectRef
     * @returns {WorkerAssignment|undefined}
     */
    findAssignmentByObjectRef(objectRef) {
        return this._byObjectRef.get(objectRef);
    }

    /**
     * The chunk's assigned machines, or undefined when it holds none.
     * @param {number} chunkKey
     * @returns {Set<number>|undefined}
     */
    findObjectRefsByChunkKey(chunkKey) {
        return this._byChunk.get(chunkKey);
    }

    /**
     * @param {WorkerAssignment} assignment
     * @returns {void}
     */
    setAssignment(assignment) {
        this._byObjectRef.set(assignment.objectRef, assignment);
        getOrCreate(this._byChunk, chunkKeyAt(assignment.x, assignment.y), () => new Set()).add(assignment.objectRef);
        getOrCreate(this._byComponent, assignment.component, () => new Set()).add(assignment.objectRef);
    }

    /**
     * @param {number} objectRef
     * @returns {void}
     */
    drop(objectRef) {
        const assignment = this._byObjectRef.get(objectRef);
        if (assignment === undefined) {
            return;
        }
        this._byObjectRef.delete(objectRef);
        removeFromGroup(this._byChunk, chunkKeyAt(assignment.x, assignment.y), objectRef);
        removeFromGroup(this._byComponent, assignment.component, objectRef);
    }

    /**
     * The assignments a recompute replaces: all of them when `components` is null, else the given
     * components' share.
     * @param {Set<number>|null} components
     * @returns {Map<number, WorkerAssignment>}
     */
    getAssignmentsByComponents(components) {
        if (components === null) {
            return new Map(this._byObjectRef);
        }
        const held = new Map();
        for (const component of components) {
            const objectRefs = this._byComponent.get(component);
            if (objectRefs === undefined) {
                continue;
            }
            for (const objectRef of objectRefs) {
                held.set(objectRef, this._byObjectRef.get(objectRef));
            }
        }
        return held;
    }

    /**
     * @returns {void}
     */
    clear() {
        this._byObjectRef = new Map();
        this._byChunk = new Map();
        this._byComponent = new Map();
    }
}
