import {cellNeighbors, tileId, chunkOrigin} from "@/common/util.js";
import {LAYER_SURFACE} from "@/common/constants.js";
import {TickPhase} from "@/sim/GameEngine.js";
import {RoadNetwork} from "@/sim/RoadNetwork.js";
import {WorkerAssignment, WorkerAssignments} from "@/sim/WorkerAssignments.js";
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
     * Recomputes the allocation over the components reachable from the seed road tiles: flood-fill,
     * attach neighbors, allocate supply, apply the manned flags, and emit the assignment deltas.
     * `affected` null recomputes the whole world; otherwise only the seeds' components rediff.
     * A machine bordering several components belongs to the one with the smallest id (the sorted
     * claim order of a full recompute); a pass that moves a machine into or out of an untouched
     * component reruns with that component included, so partial results match a full recompute.
     * @private
     * @param {RoadTile[]} seeds
     * @param {Set<number>|null} affected - accumulates the prior component ids being replaced
     * @returns {void}
     */
    _recompute(seeds, affected) {
        let seedList = seeds;
        let next;
        for (;;) {
            const components = this.roads.componentsFrom(seedList, affected);
            next = new Map();
            const contested = new Set();
            for (const component of components) {
                this._allocate(component, next, affected, contested);
            }
            if (contested.size === 0) {
                break;
            }
            seedList = [...seedList];
            for (const id of contested) {
                affected.add(id);
                seedList.push(this.roads.tileByKey(id));
            }
        }
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
     * Allocates one component: gathers attached machines off the road tiles' neighbors, then
     * grants each its full workerCost by ascending (distance, objectId) while the component's
     * housing supply lasts.
     * @private
     * @param {RoadComponent} component
     * @param {Map<number, WorkerAssignment>} next
     * @param {Set<number>|null} affected
     * @param {Set<number>|null} contested
     * @returns {void}
     */
    _allocate(component, next, affected, contested) {
        const machines = new Map();
        for (const {x, y} of cellNeighbors(component.tiles)) {
            if (this.roads.roadAt(x, y)) {
                continue;
            }
            this._attach(x, y, component, machines, next, affected, contested);
        }
        if (machines.size === 0) {
            return;
        }

        const housingList = [...component.housings].sort((a, b) => a.objectId - b.objectId);
        let supply = 0;
        for (const housing of housingList) {
            supply += housing.remaining;
        }
        let demand = 0;
        for (const machine of machines.values()) {
            demand += machine.cost;
        }

        const machineList = [...machines.values()];
        for (const machine of machineList) {
            machine.distance = this._minDistance(machine.cells, housingList);
            next.set(machine.objectId, new WorkerAssignment({
                objectId: machine.objectId,
                x: machine.x,
                y: machine.y,
                supply,
                demand,
                component: component.minTile,
            }));
        }
        machineList.sort((a, b) => a.distance - b.distance || a.objectId - b.objectId);

        let supplyLeft = supply;
        let cursor = 0;
        for (const machine of machineList) {
            if (supplyLeft === 0) {
                break;
            }
            if (machine.cost > supplyLeft) {
                // Full crew or nothing: a machine the remaining supply can't fully staff stays
                // unmanned; a cheaper machine further down may still fit.
                continue;
            }
            const granted = machine.cost;
            supplyLeft -= granted;
            const assignment = next.get(machine.objectId);
            assignment.granted = granted;
            while (housingList[cursor].remaining === 0) {
                cursor += 1;
            }
            assignment.housingObjectId = housingList[cursor].objectId;
            let cost = granted;
            while (cost > 0) {
                const housing = housingList[cursor];
                if (housing.remaining === 0) {
                    cursor += 1;
                    continue;
                }
                const take = housing.remaining < cost ? housing.remaining : cost;
                housing.remaining -= take;
                cost -= take;
            }
        }
    }

    /**
     * Records the machine occupying (x, y) as attached to the component; housings were already
     * gathered by the component fill.
     * @private
     * @param {number} x
     * @param {number} y
     * @param {RoadComponent} component
     * @param {Map<number, object>} machines
     * @param {Map<number, WorkerAssignment>} next - machines already claimed by an earlier component
     * @param {Set<number>|null} affected
     * @param {Set<number>|null} contested
     * @returns {void}
     */
    _attach(x, y, component, machines, next, affected, contested) {
        const owner = this.engine.space.ownerAt(x, y, LAYER_SURFACE);
        if (owner === null || machines.has(owner) || next.has(owner)) {
            return;
        }
        const eid = this.placed.eidByObjectId(owner);
        if (eid === undefined) {
            return;
        }
        const behavior = this.placed.behaviorFor(this.placed.typeIdOf(eid));
        if (behavior.workerCost <= 0) {
            return;
        }
        const cells = this.roads.footprintOf(behavior, eid);
        if (affected !== null && !this._claims(component, owner, cells, affected, contested)) {
            return;
        }
        const position = this.engine.Position;
        machines.set(owner, {
            objectId: owner,
            cost: behavior.workerCost,
            x: position.x[eid],
            y: position.y[eid],
            cells,
            distance: 0,
        });
    }

    /**
     * Whether this component wins the machine in a partial recompute: the smallest adjacent
     * component id claims. An untouched component gaining or losing the machine lands in
     * `contested`, forcing a rerun that recomputes it too.
     * @private
     * @param {RoadComponent} component
     * @param {number} owner
     * @param {{x: number, y: number}[]} cells
     * @param {Set<number>} affected
     * @param {Set<number>} contested
     * @returns {boolean}
     */
    _claims(component, owner, cells, affected, contested) {
        let winner = component.minTile;
        for (const {x, y} of cellNeighbors(cells)) {
            const road = this.roads.tileByKey(tileId(x, y));
            if (road !== undefined && road.component !== null && road.component < winner) {
                winner = road.component;
            }
        }
        const existing = this.assignments.get(owner);
        if (winner !== component.minTile) {
            if (!affected.has(winner) && (existing === undefined || existing.component !== winner)) {
                contested.add(winner);
            }
            return false;
        }
        if (existing !== undefined && !affected.has(existing.component)) {
            contested.add(existing.component);
        }
        return true;
    }

    /**
     * The smallest Manhattan distance between the machine's cells and any housing cell.
     * @private
     * @param {{x: number, y: number}[]} machineCells
     * @param {{cells: {x: number, y: number}[]}[]} housingList
     * @returns {number}
     */
    _minDistance(machineCells, housingList) {
        let best = Number.MAX_SAFE_INTEGER;
        for (const housing of housingList) {
            for (const housingCell of housing.cells) {
                for (const machineCell of machineCells) {
                    const distance = Math.abs(housingCell.x - machineCell.x) + Math.abs(housingCell.y - machineCell.y);
                    if (distance < best) {
                        best = distance;
                    }
                }
            }
        }
        return best;
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
