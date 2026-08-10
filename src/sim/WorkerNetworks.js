import {cellNeighbors, getOrCreate, tileId, chunkId, chunkOrigin} from "@/common/util.js";
import {LAYER_SURFACE, NEIGHBOR_DELTAS} from "@/common/constants.js";
import {TickPhase} from "@/sim/GameEngine.js";
import {RoadBehavior} from "@/sim/behaviors/RoadBehavior.js";
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
        // tileId -> {x, y, objectId, component} per occupied road tile; component is the id
        // (minTile) of the road component the tile belonged to at the last recompute.
        this._roadTiles = new Map();
        // A full recompute pending (load/rebuild); the cell/component sets below cover edits.
        this._dirtyAll = false;
        // tileId -> {x, y} cells edited since the last recompute.
        this._dirtyCells = new Map();
        // Prior component ids affected by an edit (e.g. a removed road tile's), so their
        // assignments rediff even when no surviving road tile leads back to them.
        this._dirtyComponents = new Set();
        // machineObjectId -> {housingObjectId, granted, cost, x, y, supply, demand, component};
        // every road-attached machine, housingObjectId null while no workers are granted.
        // supply/demand are its component's totals.
        this._assignments = new Map();
        // chunk -> Set<machineObjectId>, so chunk sync walks only the chunk's assignments.
        this._assignmentsByChunk = new Map();
        // component -> Set<machineObjectId>, so a partial recompute diffs only its components.
        this._assignmentsByComponent = new Map();
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this.ensureFresh(), ORDER_WORKER_RECOMPUTE);
        engine.registerChunkSync(chunk => this._chunkSync(chunk));
        engine.registerRebuildHook(() => this._rebuild());
    }

    /**
     * Registers a road cell.
     * @param {number} x
     * @param {number} y
     * @param {number} objectId
     * @returns {void}
     */
    addRoad(x, y, objectId) {
        this._roadTiles.set(tileId(x, y), {x, y, objectId, component: null});
        this._markCellDirty(x, y);
    }

    /**
     * Releases a road cell.
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    removeRoad(x, y) {
        const tile = tileId(x, y);
        const road = this._roadTiles.get(tile);
        if (road !== undefined && road.component !== null) {
            this._dirtyComponents.add(road.component);
        }
        this._roadTiles.delete(tile);
        this._markCellDirty(x, y);
    }

    /**
     * Marks the allocation stale around a placed or removed worker source/consumer's footprint.
     * @param {{x: number, y: number}[]} cells
     * @returns {void}
     */
    markDirty(cells) {
        for (const cell of cells) {
            this._markCellDirty(cell.x, cell.y);
        }
    }

    /**
     * @private
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    _markCellDirty(x, y) {
        this._dirtyCells.set(tileId(x, y), {x, y});
    }

    /**
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    roadAt(x, y) {
        return this._roadTiles.has(tileId(x, y));
    }

    /**
     * The machine's worker stats for inspect, or null when it touches no road.
     * @param {number} objectId
     * @returns {{granted: number, supply: number, demand: number}|null}
     */
    inspectFor(objectId) {
        this.ensureFresh();
        const entry = this._assignments.get(objectId);
        if (entry === undefined) {
            return null;
        }
        return {granted: entry.granted, supply: entry.supply, demand: entry.demand};
    }

    /**
     * Recomputes a dirtied allocation now, emitting its assignment deltas.
     * @returns {void}
     */
    ensureFresh() {
        if (this._dirtyAll) {
            this._dirtyAll = false;
            this._dirtyCells.clear();
            this._dirtyComponents.clear();
            this._recompute(this._roadTiles.values(), null);
            return;
        }
        if (this._dirtyCells.size === 0 && this._dirtyComponents.size === 0) {
            return;
        }
        const affected = this._dirtyComponents;
        this._dirtyComponents = new Set();
        const seeds = this._dirtySeeds();
        this._dirtyCells.clear();
        this._recompute(seeds, affected);
    }

    /**
     * The road tiles at, beside, or housing-bridged from the dirty cells: fill seeds reaching
     * every component an edit touched (each fragment of a split component borders a removed tile,
     * and a housing chain leads to the roads it bridges).
     * @private
     * @returns {{x: number, y: number, objectId: number, component: number|null}[]}
     */
    _dirtySeeds() {
        const seeds = [];
        const seenRoads = new Set();
        const seenHousings = new Set();
        const housingQueue = [];
        const consider = (x, y) => {
            const tile = tileId(x, y);
            const road = this._roadTiles.get(tile);
            if (road !== undefined) {
                if (!seenRoads.has(tile)) {
                    seenRoads.add(tile);
                    seeds.push(road);
                }
                return;
            }
            const housing = this._housingAt(x, y);
            if (housing !== null && !seenHousings.has(housing.objectId)) {
                seenHousings.add(housing.objectId);
                housingQueue.push(housing);
            }
        };
        for (const cell of this._dirtyCells.values()) {
            consider(cell.x, cell.y);
            for (const delta of NEIGHBOR_DELTAS) {
                consider(cell.x + delta.dx, cell.y + delta.dy);
            }
        }
        while (housingQueue.length > 0) {
            const housing = housingQueue.pop();
            for (const {x, y} of cellNeighbors(housing.cells)) {
                consider(x, y);
            }
        }
        return seeds;
    }

    /**
     * The housing occupying (x, y) as an allocation record, or null when the tile holds none.
     * @private
     * @param {number} x
     * @param {number} y
     * @returns {{objectId: number, remaining: number, cells: {x: number, y: number}[]}|null}
     */
    _housingAt(x, y) {
        const owner = this.engine.occupantOwnerAt(x, y, LAYER_SURFACE);
        if (owner === null) {
            return null;
        }
        const eid = this.placed.eidByObjectId(owner);
        if (eid === undefined) {
            return null;
        }
        const behavior = this.placed.behaviorFor(this.placed.typeIdOf(eid));
        if (behavior.workerSupply <= 0) {
            return null;
        }
        return {
            objectId: owner,
            remaining: behavior.workerSupply,
            cells: this._footprintOf(behavior, eid),
        };
    }

    /**
     * Recomputes the allocation over the components reachable from the seed road tiles: flood-fill,
     * attach neighbors, allocate supply, apply the manned flags, and emit the assignment deltas.
     * `affected` null recomputes the whole world; otherwise only the seeds' components rediff.
     * A machine bordering several components belongs to the one with the smallest id (the sorted
     * claim order of a full recompute); a pass that moves a machine into or out of an untouched
     * component reruns with that component included, so partial results match a full recompute.
     * @private
     * @param {Iterable<object>} seeds
     * @param {Set<number>|null} affected - accumulates the prior component ids being replaced
     * @returns {void}
     */
    _recompute(seeds, affected) {
        let seedList = seeds;
        let next;
        for (;;) {
            const components = this._collectComponents(seedList, affected);
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
                seedList.push(this._roadTiles.get(id));
            }
        }
        const previous = this._affectedAssignments(affected);
        this._applyGrants(previous, next);
        this._emitDeltas(previous, next);
        for (const objectId of previous.keys()) {
            this._dropAssignment(objectId);
        }
        for (const [objectId, entry] of next) {
            this._storeAssignment(objectId, entry);
        }
    }

    /**
     * The prior assignments a recompute replaces: all of them, or the affected components' share.
     * @private
     * @param {Set<number>|null} affected
     * @returns {Map<number, object>}
     */
    _affectedAssignments(affected) {
        if (affected === null) {
            return new Map(this._assignments);
        }
        const previous = new Map();
        for (const component of affected) {
            const objectIds = this._assignmentsByComponent.get(component);
            if (objectIds === undefined) {
                continue;
            }
            for (const objectId of objectIds) {
                previous.set(objectId, this._assignments.get(objectId));
            }
        }
        return previous;
    }

    /**
     * @private
     * @param {number} objectId
     * @param {object} entry
     * @returns {void}
     */
    _storeAssignment(objectId, entry) {
        this._assignments.set(objectId, entry);
        getOrCreate(this._assignmentsByChunk, chunkId(entry.x, entry.y), () => new Set()).add(objectId);
        getOrCreate(this._assignmentsByComponent, entry.component, () => new Set()).add(objectId);
    }

    /**
     * @private
     * @param {number} objectId
     * @returns {void}
     */
    _dropAssignment(objectId) {
        const entry = this._assignments.get(objectId);
        if (entry === undefined) {
            return;
        }
        this._assignments.delete(objectId);
        const chunk = chunkId(entry.x, entry.y);
        const chunkSet = this._assignmentsByChunk.get(chunk);
        chunkSet.delete(objectId);
        if (chunkSet.size === 0) {
            this._assignmentsByChunk.delete(chunk);
        }
        const componentSet = this._assignmentsByComponent.get(entry.component);
        componentSet.delete(objectId);
        if (componentSet.size === 0) {
            this._assignmentsByComponent.delete(entry.component);
        }
    }

    /**
     * The connected components reachable from the seeds — road tiles plus the housings bridging
     * them — each ordered by its smallest road tileId so the allocation is deterministic across
     * rebuilds. Stamps each visited road tile's component id, gathering the prior ids into
     * `affected`.
     * @private
     * @param {Iterable<object>} seeds
     * @param {Set<number>|null} affected
     * @returns {{minTile: number, tiles: object[], housings: object[]}[]}
     */
    _collectComponents(seeds, affected) {
        const seen = new Set();
        const seenHousings = new Set();
        const components = [];
        for (const seed of seeds) {
            const seedTile = tileId(seed.x, seed.y);
            if (seen.has(seedTile)) {
                continue;
            }
            seen.add(seedTile);
            this._notePriorComponent(seed, affected);
            let minTile = seedTile;
            const tiles = [seed];
            const housings = [];
            const roadQueue = [seed];
            const housingQueue = [];
            const visit = (x, y) => {
                const neighborTile = tileId(x, y);
                const road = this._roadTiles.get(neighborTile);
                if (road !== undefined) {
                    if (seen.has(neighborTile)) {
                        return;
                    }
                    seen.add(neighborTile);
                    this._notePriorComponent(road, affected);
                    if (neighborTile < minTile) {
                        minTile = neighborTile;
                    }
                    tiles.push(road);
                    roadQueue.push(road);
                    return;
                }
                const housing = this._housingAt(x, y);
                if (housing !== null && !seenHousings.has(housing.objectId)) {
                    seenHousings.add(housing.objectId);
                    housings.push(housing);
                    housingQueue.push(housing);
                }
            };
            while (roadQueue.length > 0 || housingQueue.length > 0) {
                if (roadQueue.length > 0) {
                    const current = roadQueue.pop();
                    for (const delta of NEIGHBOR_DELTAS) {
                        visit(current.x + delta.dx, current.y + delta.dy);
                    }
                } else {
                    const housing = housingQueue.pop();
                    for (const {x, y} of cellNeighbors(housing.cells)) {
                        visit(x, y);
                    }
                }
            }
            components.push({minTile, tiles, housings});
        }
        components.sort((a, b) => a.minTile - b.minTile);
        for (const component of components) {
            for (const road of component.tiles) {
                road.component = component.minTile;
            }
        }
        return components;
    }

    /**
     * @private
     * @param {{component: number|null}} road
     * @param {Set<number>|null} affected
     * @returns {void}
     */
    _notePriorComponent(road, affected) {
        if (affected !== null && road.component !== null) {
            affected.add(road.component);
        }
    }

    /**
     * Allocates one component: gathers attached machines off the road tiles' neighbors, then
     * grants each its full workerCost by ascending (distance, objectId) while the component's
     * housing supply lasts.
     * @private
     * @param {{minTile: number, tiles: object[], housings: object[]}} component
     * @param {Map<number, object>} next
     * @param {Set<number>|null} affected
     * @param {Set<number>|null} contested
     * @returns {void}
     */
    _allocate(component, next, affected, contested) {
        const machines = new Map();
        for (const {x, y} of cellNeighbors(component.tiles)) {
            if (this._roadTiles.has(tileId(x, y))) {
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
            next.set(machine.objectId, {
                housingObjectId: null,
                granted: 0,
                cost: machine.cost,
                x: machine.x,
                y: machine.y,
                supply,
                demand,
                component: component.minTile,
            });
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
            const entry = next.get(machine.objectId);
            entry.granted = granted;
            while (housingList[cursor].remaining === 0) {
                cursor += 1;
            }
            entry.housingObjectId = housingList[cursor].objectId;
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
     * @param {{minTile: number}} component
     * @param {Map<number, object>} machines
     * @param {Map<number, object>} next - machines already claimed by an earlier component
     * @param {Set<number>|null} affected
     * @param {Set<number>|null} contested
     * @returns {void}
     */
    _attach(x, y, component, machines, next, affected, contested) {
        const owner = this.engine.occupantOwnerAt(x, y, LAYER_SURFACE);
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
        const cells = this._footprintOf(behavior, eid);
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
     * @param {{minTile: number}} component
     * @param {number} owner
     * @param {{x: number, y: number}[]} cells
     * @param {Set<number>} affected
     * @param {Set<number>} contested
     * @returns {boolean}
     */
    _claims(component, owner, cells, affected, contested) {
        let winner = component.minTile;
        for (const {x, y} of cellNeighbors(cells)) {
            const road = this._roadTiles.get(tileId(x, y));
            if (road !== undefined && road.component !== null && road.component < winner) {
                winner = road.component;
            }
        }
        const existing = this._assignments.get(owner);
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
     * @private
     * @param {AbstractBehavior} behavior
     * @param {number} eid
     * @returns {{x: number, y: number}[]}
     */
    _footprintOf(behavior, eid) {
        const position = this.engine.Position;
        return this.engine.footprint(behavior.type, position.x[eid], position.y[eid], position.direction[eid]);
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
     * @param {Map<number, object>} previous
     * @param {Map<number, object>} next
     * @returns {void}
     */
    _applyGrants(previous, next) {
        for (const [objectId, entry] of previous) {
            if (entry.granted > 0 && !next.has(objectId)) {
                this._setGranted(objectId, 0);
            }
        }
        for (const [objectId, entry] of next) {
            const before = previous.get(objectId);
            if (before === undefined || before.granted !== entry.granted) {
                this._setGranted(objectId, entry.granted);
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
     * @param {Map<number, object>} previous
     * @param {Map<number, object>} next
     * @returns {void}
     */
    _emitDeltas(previous, next) {
        for (const [objectId, entry] of next) {
            const before = previous.get(objectId);
            if (before !== undefined
                && before.housingObjectId === entry.housingObjectId
                && before.granted === entry.granted) {
                continue;
            }
            let housingId = entry.housingObjectId;
            if (housingId === null) {
                housingId = NO_HOUSING;
            }
            this.engine.emitEvent(new WorkerAssignmentEvent(
                entry.x,
                entry.y,
                objectId,
                housingId,
                entry.granted,
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
        const objectIds = this._assignmentsByChunk.get(chunk);
        if (objectIds === undefined) {
            return [];
        }
        const origin = chunkOrigin(chunk);
        const batch = new WorkerAssignmentBatchEvent(origin.x, origin.y);
        for (const objectId of objectIds) {
            const entry = this._assignments.get(objectId);
            const housingId = entry.housingObjectId === null ? NO_HOUSING : entry.housingObjectId;
            batch.add(objectId, housingId, entry.granted, entry.x, entry.y);
        }
        return [batch];
    }

    /**
     * Re-registers every placed road's cells after a load, then recomputes the allocation.
     * @private
     * @returns {void}
     */
    _rebuild() {
        this._roadTiles = new Map();
        this._assignments = new Map();
        this._assignmentsByChunk = new Map();
        this._assignmentsByComponent = new Map();
        const def = this.placed.def;
        const position = this.engine.Position;
        for (let row = 0; row < def.count; row += 1) {
            const eid = def.eids[row];
            const behavior = this.placed.behaviorFor(def.store.typeId[row]);
            if (!(behavior instanceof RoadBehavior)) {
                continue;
            }
            const objectId = def.store.objectId[row];
            for (const cell of this._footprintOf(behavior, eid)) {
                this.addRoad(cell.x, cell.y, objectId);
            }
        }
        this._dirtyAll = true;
        this.ensureFresh();
    }
}
