import {chunkOrigin} from "@/common/util.js";
import {AbstractSystem} from "@/sim/AbstractSystem.js";
import {RoadNetwork} from "@/sim/RoadNetwork.js";
import {WorkerAllocation} from "@/sim/WorkerAllocation.js";
import {WorkerAssignments} from "@/sim/WorkerAssignments.js";
import {WorkerAssignmentEvent, WorkerAssignmentBatchEvent, NO_HOUSING} from "@/common/WorkerEvents.js";

// Worker recompute runs before any machine countdown reads the manned flags.
const ORDER_WORKER_RECOMPUTE = -20;

/**
 * Road-network workers: roads and housings form networks by adjacency (a housing bridges the roads
 * and housings its footprint touches), each housing's workerSupply feeds its network once, and
 * road-adjacent machines consume their full workerCost by ascending (Manhattan distance to housing,
 * objectRef) and run manned; a machine the remaining supply can't fully staff gets nothing.
 * Edits mark their cells dirty; the allocation recomputes lazily (message apply, tick, chunk sync,
 * inspect), refilling only the road components the dirty cells touch.
 */
export class WorkerNetworks extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     */
    constructor(engine, placed) {
        super(ORDER_WORKER_RECOMPUTE);
        this.engine = engine;
        this.placed = placed;
        /**
         * The road tiles, the housings bridging them, and the edits staling their connectivity.
         * @type {RoadNetwork}
         */
        this.roads = new RoadNetwork(engine, placed);
        /**
         * Every road-attached machine's standing allocation.
         * @type {WorkerAssignments}
         */
        this.assignments = new WorkerAssignments();
        /**
         * The pass handing each component's housing supply to the machines on it.
         * @type {WorkerAllocation}
         */
        this.allocation = new WorkerAllocation(engine, placed, this.roads, this.assignments);
        engine.registerSystem(this);
    }

    /**
     * The machine's worker stats for inspect, or null when it touches no road.
     * @param {number} objectRef
     * @returns {{granted: number, supply: number, demand: number}|null}
     */
    findWorkerStatsByObjectRef(objectRef) {
        this.ensureFresh();
        const assignment = this.assignments.findAssignmentByObjectRef(objectRef);
        if (assignment === undefined) {
            return null;
        }
        return {granted: assignment.granted, supply: assignment.supply, demand: assignment.demand};
    }

    /**
     * Recomputes a dirtied allocation now, emitting its assignment deltas.
     * @returns {void}
     */
    submitIntents() {
        this.ensureFresh();
    }

    ensureFresh() {
        const dirty = this.roads.popDirty();
        if (dirty === null) {
            return;
        }
        this._recompute(dirty.seeds, dirty.affected);
    }

    /**
     * Reallocates the components the seeds reach, then applies the manned flags and emits the
     * assignment deltas. `affected` null recomputes the whole world.
     * @private
     * @param {RoadTile[]} seeds
     * @param {Set<number>|null} affected - accumulates the prior component ids being replaced
     * @returns {void}
     */
    _recompute(seeds, affected) {
        const next = this.allocation.run(seeds, affected);
        const previous = this.assignments.getAssignmentsByComponents(affected);
        this._applyGrants(previous, next);
        this._emitWorkerAssignments(previous, next);
        for (const objectRef of previous.keys()) {
            this.assignments.removeAssignment(objectRef);
        }
        for (const assignment of next.values()) {
            this.assignments.setAssignment(assignment);
        }
    }

    /**
     * Writes each machine's granted workers through its behavior, clearing machines that lost them.
     * @private
     * @param {Map<number, WorkerAssignment>} previous
     * @param {Map<number, WorkerAssignment>} next
     * @returns {void}
     */
    _applyGrants(previous, next) {
        for (const [objectRef, assignment] of previous) {
            if (assignment.granted > 0 && !next.has(objectRef)) {
                this._setGranted(objectRef, 0);
            }
        }
        for (const [objectRef, assignment] of next) {
            const before = previous.get(objectRef);
            if (before === undefined || before.granted !== assignment.granted) {
                this._setGranted(objectRef, assignment.granted);
            }
        }
    }

    /**
     * @private
     * @param {number} objectRef
     * @param {number} granted
     * @returns {void}
     */
    _setGranted(objectRef, granted) {
        const eid = this.placed.findEidByObjectRef(objectRef);
        if (eid === undefined) {
            return;
        }
        const behavior = this.placed.getBehaviorByTypeId(this.placed.getObjectTypeIdByEid(eid));
        behavior.setWorkers(this.engine, eid, granted);
    }

    /**
     * Emits one WorkerAssignmentEvent per changed machine: grant/housing changes for attached
     * machines, and a detach event for machines that left the network.
     * @private
     * @param {Map<number, WorkerAssignment>} previous
     * @param {Map<number, WorkerAssignment>} next
     * @returns {void}
     */
    _emitWorkerAssignments(previous, next) {
        for (const [objectRef, assignment] of next) {
            const before = previous.get(objectRef);
            if (before !== undefined
                && before.housingObjectRef === assignment.housingObjectRef
                && before.granted === assignment.granted) {
                continue;
            }
            let housingId = assignment.housingObjectRef;
            if (housingId === null) {
                housingId = NO_HOUSING;
            }
            this.engine.emitEvent(new WorkerAssignmentEvent(
                assignment.x,
                assignment.y,
                objectRef,
                housingId,
                assignment.granted,
                1,
            ));
        }
        for (const [objectRef, before] of previous) {
            if (!next.has(objectRef)) {
                this.engine.emitEvent(new WorkerAssignmentEvent(before.x, before.y, objectRef, NO_HOUSING, 0, 0));
            }
        }
    }

    /**
     * The chunk's road-attached machines as one batch, or nothing when it holds none.
     * @param {number} chunkKey
     * @returns {WorkerAssignmentBatchEvent[]}
     */
    chunkSync(chunkKey) {
        this.ensureFresh();
        const objectRefs = this.assignments.findObjectRefsByChunkKey(chunkKey);
        if (objectRefs === undefined) {
            return [];
        }
        const origin = chunkOrigin(chunkKey);
        const batch = new WorkerAssignmentBatchEvent(origin.x, origin.y);
        for (const objectRef of objectRefs) {
            const assignment = this.assignments.findAssignmentByObjectRef(objectRef);
            const housingId = assignment.housingObjectRef === null ? NO_HOUSING : assignment.housingObjectRef;
            batch.add(objectRef, housingId, assignment.granted, assignment.x, assignment.y);
        }
        return [batch];
    }

    /**
     * Re-registers every placed road's cells after a load, then recomputes the allocation.
     * @returns {void}
     */
    rebuild() {
        this.assignments.clear();
        this.roads.rebuild();
        this.ensureFresh();
    }
}
