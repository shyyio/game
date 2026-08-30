import {chunkOrigin} from "@/common/util.js";
import {TickPhase} from "@/sim/GameEngine.js";
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
 * objectId) and run manned; a machine the remaining supply can't fully staff gets nothing.
 * Edits mark their cells dirty; the allocation recomputes lazily (message apply, tick, chunk sync,
 * inspect), refilling only the road components the dirty cells touch.
 */
export class WorkerNetworks {

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     */
    constructor(engine, placed) {
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
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this.ensureFresh(), ORDER_WORKER_RECOMPUTE);
        engine.registerChunkSync(chunk => this._chunkSync(chunk));
        engine.snapshots.registerRebuildHook(() => this._rebuild());
    }

    /**
     * The machine's worker stats for inspect, or null when it touches no road.
     * @param {number} objectId
     * @returns {{granted: number, supply: number, demand: number}|null}
     */
    inspectFor(objectId) {
        this.ensureFresh();
        const assignment = this.assignments.get(objectId);
        if (assignment === undefined) {
            return null;
        }
        return {granted: assignment.granted, supply: assignment.supply, demand: assignment.demand};
    }

    /**
     * Recomputes a dirtied allocation now, emitting its assignment deltas.
     * @returns {void}
     */
    ensureFresh() {
        const dirty = this.roads.takeDirty();
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
        const previous = this.assignments.within(affected);
        this._applyGrants(previous, next);
        this._emitDeltas(previous, next);
        for (const objectId of previous.keys()) {
            this.assignments.drop(objectId);
        }
        for (const assignment of next.values()) {
            this.assignments.store(assignment);
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
        for (const [objectId, assignment] of previous) {
            if (assignment.granted > 0 && !next.has(objectId)) {
                this._setGranted(objectId, 0);
            }
        }
        for (const [objectId, assignment] of next) {
            const before = previous.get(objectId);
            if (before === undefined || before.granted !== assignment.granted) {
                this._setGranted(objectId, assignment.granted);
            }
        }
    }

    /**
     * @private
     * @param {number} objectId
     * @param {number} granted
     * @returns {void}
     */
    _setGranted(objectId, granted) {
        const eid = this.placed.eidByObjectId(objectId);
        if (eid === undefined) {
            return;
        }
        const behavior = this.placed.behaviorFor(this.placed.typeIdOf(eid));
        behavior.setWorkers(this.engine, this.placed, eid, granted);
    }

    /**
     * Emits one WorkerAssignmentEvent per changed machine: grant/housing changes for attached
     * machines, and a detach event for machines that left the network.
     * @private
     * @param {Map<number, WorkerAssignment>} previous
     * @param {Map<number, WorkerAssignment>} next
     * @returns {void}
     */
    _emitDeltas(previous, next) {
        for (const [objectId, assignment] of next) {
            const before = previous.get(objectId);
            if (before !== undefined
                && before.housingObjectId === assignment.housingObjectId
                && before.granted === assignment.granted) {
                continue;
            }
            let housingId = assignment.housingObjectId;
            if (housingId === null) {
                housingId = NO_HOUSING;
            }
            this.engine.emitEvent(new WorkerAssignmentEvent(
                assignment.x,
                assignment.y,
                objectId,
                housingId,
                assignment.granted,
                1,
            ));
        }
        for (const [objectId, before] of previous) {
            if (!next.has(objectId)) {
                this.engine.emitEvent(new WorkerAssignmentEvent(before.x, before.y, objectId, NO_HOUSING, 0, 0));
            }
        }
    }

    /**
     * The chunk's road-attached machines as one batch, or nothing when it holds none.
     * @private
     * @param {number} chunk
     * @returns {WorkerAssignmentBatchEvent[]}
     */
    _chunkSync(chunk) {
        this.ensureFresh();
        const objectIds = this.assignments.inChunk(chunk);
        if (objectIds === undefined) {
            return [];
        }
        const origin = chunkOrigin(chunk);
        const batch = new WorkerAssignmentBatchEvent(origin.x, origin.y);
        for (const objectId of objectIds) {
            const assignment = this.assignments.get(objectId);
            const housingId = assignment.housingObjectId === null ? NO_HOUSING : assignment.housingObjectId;
            batch.add(objectId, housingId, assignment.granted, assignment.x, assignment.y);
        }
        return [batch];
    }

    /**
     * Re-registers every placed road's cells after a load, then recomputes the allocation.
     * @private
     * @returns {void}
     */
    _rebuild() {
        this.assignments.clear();
        this.roads.rebuild();
        this.ensureFresh();
    }
}
