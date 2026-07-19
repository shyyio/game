import {cellNeighbors, tileId, chunkId, chunkOrigin} from "@/common/util.js";
import {LAYER_SURFACE, NEIGHBOR_DELTAS} from "@/common/constants.js";
import {TickPhase} from "@/common/sim/GameEngine.js";
import {RoadBehavior} from "@/common/sim/behaviors.js";
import {LaborAssignmentEvent, LaborAssignmentBatchEvent, NO_HOUSING} from "@/common/LaborEvents.js";

// Labor recompute runs before any machine countdown reads the manned flags.
const ORDER_LABOR_RECOMPUTE = -20;

/**
 * Road-network labor: a housing's laborSupply feeds the connected road component, road-adjacent
 * machines consume their full laborCost by ascending (Manhattan distance to housing, objectId) and
 * run manned; a machine the remaining supply can't fully staff gets nothing.
 * Edits mark the allocation dirty; it recomputes lazily (tick, chunk sync, inspect).
 */
export class LaborNetworks {

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     */
    constructor(engine, placed) {
        this.engine = engine;
        this.placed = placed;
        // tileId -> {x, y, objectId} per occupied road tile.
        this._roadTiles = new Map();
        this._dirty = false;
        // machineObjectId -> {housingObjectId, granted, cost, x, y, supply, demand}; every
        // road-attached machine, housingObjectId null while no workers are granted. supply/demand
        // are its component's totals.
        this._assignments = new Map();
        // chunk -> machineObjectIds, so chunk sync walks only the chunk's assignments.
        this._assignmentsByChunk = new Map();
        engine.registerSystem(TickPhase.SUBMIT_INTENTS, () => this._ensureFresh(), ORDER_LABOR_RECOMPUTE);
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
        this._roadTiles.set(tileId(x, y), {x, y, objectId});
        this._dirty = true;
    }

    /**
     * Releases a road cell.
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    removeRoad(x, y) {
        this._roadTiles.delete(tileId(x, y));
        this._dirty = true;
    }

    /**
     * Marks the allocation stale (a labor source/consumer was placed or removed).
     * @returns {void}
     */
    markDirty() {
        this._dirty = true;
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
     * The machine's labor stats for inspect, or null when it touches no road.
     * @param {number} objectId
     * @returns {{granted: number, supply: number, demand: number}|null}
     */
    inspectFor(objectId) {
        this._ensureFresh();
        const entry = this._assignments.get(objectId);
        if (entry === undefined) {
            return null;
        }
        return {granted: entry.granted, supply: entry.supply, demand: entry.demand};
    }

    /**
     * @private
     * @returns {void}
     */
    _ensureFresh() {
        if (!this._dirty) {
            return;
        }
        this._dirty = false;
        this._recompute();
    }

    /**
     * Rebuilds the full allocation: flood-fill road components, attach neighbors, allocate supply,
     * apply the manned flags, and emit the assignment deltas.
     * @private
     * @returns {void}
     */
    _recompute() {
        const previous = this._assignments;
        const next = new Map();
        for (const component of this._collectComponents()) {
            this._allocate(component, next);
        }
        this._applyGrants(previous, next);
        this._emitDeltas(previous, next);
        this._assignments = next;
        this._assignmentsByChunk = new Map();
        for (const [objectId, entry] of next) {
            const chunk = chunkId(entry.x, entry.y);
            let objectIds = this._assignmentsByChunk.get(chunk);
            if (objectIds === undefined) {
                objectIds = [];
                this._assignmentsByChunk.set(chunk, objectIds);
            }
            objectIds.push(objectId);
        }
    }

    /**
     * The connected road components, each a tile list, ordered by their smallest tileId so the
     * allocation is deterministic across rebuilds.
     * @private
     * @returns {{minTile: number, tiles: {x: number, y: number, objectId: number}[]}[]}
     */
    _collectComponents() {
        const seen = new Set();
        const components = [];
        for (const [tile, road] of this._roadTiles) {
            if (seen.has(tile)) {
                continue;
            }
            seen.add(tile);
            let minTile = tile;
            const tiles = [road];
            const queue = [road];
            while (queue.length > 0) {
                const current = queue.pop();
                for (const delta of NEIGHBOR_DELTAS) {
                    const neighborTile = tileId(current.x + delta.dx, current.y + delta.dy);
                    if (seen.has(neighborTile)) {
                        continue;
                    }
                    const neighbor = this._roadTiles.get(neighborTile);
                    if (neighbor === undefined) {
                        continue;
                    }
                    seen.add(neighborTile);
                    if (neighborTile < minTile) {
                        minTile = neighborTile;
                    }
                    tiles.push(neighbor);
                    queue.push(neighbor);
                }
            }
            components.push({minTile, tiles});
        }
        components.sort((a, b) => a.minTile - b.minTile);
        return components;
    }

    /**
     * Allocates one component: gathers attached housings/machines off the road tiles' neighbors,
     * then grants each machine its full laborCost by ascending (distance, objectId) while supply lasts.
     * @private
     * @param {{minTile: number, tiles: {x: number, y: number, objectId: number}[]}} component
     * @param {Map<number, object>} next
     * @returns {void}
     */
    _allocate(component, next) {
        const housings = new Map();
        const machines = new Map();
        for (const {x, y} of cellNeighbors(component.tiles)) {
            if (this._roadTiles.has(tileId(x, y))) {
                continue;
            }
            this._attach(x, y, housings, machines, next);
        }
        if (machines.size === 0) {
            return;
        }

        const housingList = [...housings.values()].sort((a, b) => a.objectId - b.objectId);
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
     * Records the object occupying (x, y) as an attached housing or machine of the component.
     * @private
     * @param {number} x
     * @param {number} y
     * @param {Map<number, object>} housings
     * @param {Map<number, object>} machines
     * @param {Map<number, object>} next - machines already claimed by an earlier component
     * @returns {void}
     */
    _attach(x, y, housings, machines, next) {
        const owner = this.engine.occupantOwnerAt(x, y, LAYER_SURFACE);
        if (owner === null || housings.has(owner) || machines.has(owner) || next.has(owner)) {
            return;
        }
        const eid = this.placed.eidByObjectId(owner);
        if (eid === undefined) {
            return;
        }
        const behavior = this.placed.behaviorFor(this.placed.typeIdOf(eid));
        if (behavior.laborSupply > 0) {
            housings.set(owner, {
                objectId: owner,
                remaining: behavior.laborSupply,
                cells: this._footprintOf(behavior, eid),
            });
        } else if (behavior.laborCost > 0) {
            const position = this.engine.Position;
            machines.set(owner, {
                objectId: owner,
                cost: behavior.laborCost,
                x: position.x[eid],
                y: position.y[eid],
                cells: this._footprintOf(behavior, eid),
                distance: 0,
            });
        }
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
        behavior.setLabor(this.engine, this.placed, eid, granted);
    }

    /**
     * Emits one LaborAssignmentEvent per changed machine: grant/housing changes for attached
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
            this.engine.emitEvent(new LaborAssignmentEvent(
                entry.x,
                entry.y,
                objectId,
                entry.housingObjectId === null ? NO_HOUSING : entry.housingObjectId,
                entry.granted,
                1,
            ));
        }
        for (const [objectId, before] of previous) {
            if (!next.has(objectId)) {
                this.engine.emitEvent(new LaborAssignmentEvent(before.x, before.y, objectId, NO_HOUSING, 0, 0));
            }
        }
    }

    /**
     * The chunk's road-attached machines as one batch, or nothing when it holds none.
     * @private
     * @param {number} chunk
     * @returns {LaborAssignmentBatchEvent[]}
     */
    _chunkSync(chunk) {
        this._ensureFresh();
        const objectIds = this._assignmentsByChunk.get(chunk);
        if (objectIds === undefined) {
            return [];
        }
        const origin = chunkOrigin(chunk);
        const batch = new LaborAssignmentBatchEvent(origin.x, origin.y);
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
        this._dirty = true;
        this._ensureFresh();
    }
}
