import {cellNeighbors, tileId} from "@/common/util.js";
import {LAYER_SURFACE} from "@/common/constants.js";
import {WorkerAssignment} from "@/sim/WorkerAssignments.js";

/**
 * One road-attached machine's claim on its component's supply. `distance` is its Manhattan reach to
 * the nearest housing, the order workers are handed out in.
 */
export class MachineDemand {

    /**
     * @param {number} objectId
     * @param {number} cost
     * @param {number} x
     * @param {number} y
     * @param {{x: number, y: number}[]} cells
     */
    constructor(objectId, cost, x, y, cells) {
        this.objectId = objectId;
        this.cost = cost;
        this.x = x;
        this.y = y;
        this.cells = cells;
        this.distance = 0;
    }
}

/**
 * Hands each road component's housing supply to the machines attached to it: every machine takes
 * its full workerCost by ascending (distance to housing, objectId) while supply lasts, and one the
 * remainder can't fully staff gets nothing.
 */
export class WorkerAllocation {

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     * @param {RoadNetwork} roads
     * @param {WorkerAssignments} assignments
     */
    constructor(engine, placed, roads, assignments) {
        this.engine = engine;
        this.placed = placed;
        this.roads = roads;
        this.assignments = assignments;
        // The pass in flight: the assignments being built, the prior component ids it replaces, and
        // the untouched components a machine crossed into or out of.
        this._next = new Map();
        this._affected = null;
        this._contested = new Set();
    }

    /**
     * The assignments the seeds' components deserve. `affected` null allocates the whole world;
     * otherwise it collects the prior component ids being replaced, growing as reruns widen the
     * pass. A machine bordering several components belongs to the one with the smallest id (the
     * claim order of a full recompute); a pass that moves a machine into or out of an untouched
     * component reruns with that component included, so partial results match a full one.
     * @param {RoadTile[]} seeds
     * @param {Set<number>|null} affected
     * @returns {Map<number, WorkerAssignment>}
     */
    run(seeds, affected) {
        this._affected = affected;
        let seedList = seeds;
        for (;;) {
            const components = this.roads.componentsFrom(seedList, affected);
            this._next = new Map();
            this._contested = new Set();
            for (const component of components) {
                this._allocate(component);
            }
            if (this._contested.size === 0) {
                return this._next;
            }
            seedList = [...seedList];
            for (const id of this._contested) {
                affected.add(id);
                seedList.push(this.roads.tileByKey(id));
            }
        }
    }

    /**
     * Allocates one component: gathers the machines attached off its road tiles' neighbors, then
     * grants each its full cost while the housings' supply lasts.
     * @private
     * @param {RoadComponent} component
     * @returns {void}
     */
    _allocate(component) {
        const machines = new Map();
        for (const {x, y} of cellNeighbors(component.tiles)) {
            if (this.roads.roadAt(x, y)) {
                continue;
            }
            this._attach(x, y, component, machines);
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
            this._next.set(machine.objectId, new WorkerAssignment({
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
            const assignment = this._next.get(machine.objectId);
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
     * @param {Map<number, MachineDemand>} machines
     * @returns {void}
     */
    _attach(x, y, component, machines) {
        const owner = this.engine.space.ownerAt(x, y, LAYER_SURFACE);
        if (owner === null || machines.has(owner) || this._next.has(owner)) {
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
        if (this._affected !== null && !this._claims(component, owner, cells)) {
            return;
        }
        const position = this.engine.Position;
        machines.set(owner, new MachineDemand(owner, behavior.workerCost, position.x[eid], position.y[eid], cells));
    }

    /**
     * Whether this component wins the machine in a partial pass: the smallest adjacent component id
     * claims. An untouched component gaining or losing the machine lands in the contested set,
     * forcing a rerun that allocates it too.
     * @private
     * @param {RoadComponent} component
     * @param {number} owner
     * @param {{x: number, y: number}[]} cells
     * @returns {boolean}
     */
    _claims(component, owner, cells) {
        let winner = component.minTile;
        for (const {x, y} of cellNeighbors(cells)) {
            const road = this.roads.tileByKey(tileId(x, y));
            if (road !== undefined && road.component !== null && road.component < winner) {
                winner = road.component;
            }
        }
        const existing = this.assignments.get(owner);
        if (winner !== component.minTile) {
            if (!this._affected.has(winner) && (existing === undefined || existing.component !== winner)) {
                this._contested.add(winner);
            }
            return false;
        }
        if (existing !== undefined && !this._affected.has(existing.component)) {
            this._contested.add(existing.component);
        }
        return true;
    }

    /**
     * The smallest Manhattan distance between the machine's cells and any housing cell.
     * @private
     * @param {{x: number, y: number}[]} machineCells
     * @param {HousingSupply[]} housingList
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
}
