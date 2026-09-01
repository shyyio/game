import {cellNeighbors, tileId} from "@/common/util.js";
import {LAYER_SURFACE, NEIGHBOR_DELTAS} from "@/common/constants.js";
import {RoadBehavior} from "@/sim/behaviors/RoadBehavior.js";
import {floodRoadComponent} from "@/common/roadFlood.js";

/**
 * One occupied road tile. `component` is the id of the road component it belonged to at the last
 * recompute, null until it is first stamped.
 */
export class RoadTile {

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} objectId
     */
    constructor(x, y, objectId) {
        this.x = x;
        this.y = y;
        this.key = tileId(x, y);
        this.objectId = objectId;
        /** @type {number|null} */
        this.component = null;
    }
}

/**
 * A housing's contribution to the component it bridges; `remaining` is drawn down as the allocation
 * hands its workers out.
 */
export class HousingSupply {

    /**
     * @param {number} objectId
     * @param {number} remaining
     * @param {{x: number, y: number}[]} cells
     */
    constructor(objectId, remaining, cells) {
        this.objectId = objectId;
        this.remaining = remaining;
        this.cells = cells;
    }
}

/**
 * One connected component: the road tiles reachable from each other, plus the housings bridging
 * them. Identified by its smallest road tile, so the allocation order survives a rebuild.
 */
export class RoadComponent {

    /**
     * @param {RoadTile} seed
     */
    constructor(seed) {
        this.minTile = seed.key;
        this.tiles = [seed];
        /** @type {HousingSupply[]} */
        this.housings = [];
    }

    /**
     * @param {RoadTile} tile
     * @returns {void}
     */
    addTile(tile) {
        if (tile.key < this.minTile) {
            this.minTile = tile.key;
        }
        this.tiles.push(tile);
    }

    /**
     * Records this component's id on every tile in it.
     * @returns {void}
     */
    stamp() {
        for (const tile of this.tiles) {
            tile.component = this.minTile;
        }
    }
}

/**
 * The road tiles, the housings bridging them, and the edits that stale their connectivity. Roads
 * and housings form components by adjacency; a housing bridges the roads and housings its footprint
 * touches.
 */
export class RoadNetwork {

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjects} placed
     */
    constructor(engine, placed) {
        this.engine = engine;
        this.placed = placed;
        /**
         * tileId -> the road on it.
         * @type {Map<number, RoadTile>}
         * @private
         */
        this._tiles = new Map();
        // A full recompute pending (load/rebuild); the cell/component sets below cover edits.
        this._dirtyAll = false;
        // tileId -> {x, y} cells edited since the last recompute.
        this._dirtyCells = new Map();
        // Prior component ids affected by an edit (e.g. a removed road tile's), so their
        // assignments rediff even when no surviving road tile leads back to them.
        this._dirtyComponents = new Set();
    }

    /**
     * Registers a road cell.
     * @param {number} x
     * @param {number} y
     * @param {number} objectId
     * @returns {void}
     */
    addRoad(x, y, objectId) {
        this._tiles.set(tileId(x, y), new RoadTile(x, y, objectId));
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
        const road = this._tiles.get(tile);
        if (road !== undefined && road.component !== null) {
            this._dirtyComponents.add(road.component);
        }
        this._tiles.delete(tile);
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
        return this._tiles.has(tileId(x, y));
    }

    /**
     * @param {number} key - a tileId
     * @returns {RoadTile|undefined}
     */
    tileByKey(key) {
        return this._tiles.get(key);
    }

    /**
     * Takes the pending edits as the fill seeds they need, or null when nothing changed. `affected`
     * is null for a full recompute, otherwise the set the fill adds each seed's prior component to.
     * @returns {{seeds: RoadTile[], affected: Set<number>|null}|null}
     */
    takeDirty() {
        if (this._dirtyAll) {
            this._dirtyAll = false;
            this._dirtyCells.clear();
            this._dirtyComponents.clear();
            return {seeds: [...this._tiles.values()], affected: null};
        }
        if (this._dirtyCells.size === 0 && this._dirtyComponents.size === 0) {
            return null;
        }
        const affected = this._dirtyComponents;
        this._dirtyComponents = new Set();
        const seeds = this._dirtySeeds();
        this._dirtyCells.clear();
        return {seeds, affected};
    }

    /**
     * The road tiles at, beside, or housing-bridged from the dirty cells: fill seeds reaching
     * every component an edit touched (each fragment of a split component borders a removed tile,
     * and a housing chain leads to the roads it bridges).
     * @private
     * @returns {RoadTile[]}
     */
    _dirtySeeds() {
        const seeds = [];
        const seenRoads = new Set();
        const seenHousings = new Set();
        const housingQueue = [];
        const consider = (x, y) => {
            const tile = tileId(x, y);
            const road = this._tiles.get(tile);
            if (road !== undefined) {
                if (!seenRoads.has(tile)) {
                    seenRoads.add(tile);
                    seeds.push(road);
                }
                return;
            }
            const housing = this.housingAt(x, y);
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
     * The housing occupying (x, y), or null when the tile holds none.
     * @param {number} x
     * @param {number} y
     * @returns {HousingSupply|null}
     */
    housingAt(x, y) {
        const owner = this.engine.space.ownerAt(x, y, LAYER_SURFACE);
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
        return new HousingSupply(owner, behavior.workerSupply, this.footprintOf(behavior, eid));
    }

    /**
     * @param {AbstractBehavior} behavior
     * @param {number} eid
     * @returns {{x: number, y: number}[]}
     */
    footprintOf(behavior, eid) {
        const position = this.engine.Position;
        return this.engine.footprint(behavior.type, position.x[eid], position.y[eid], position.direction[eid]);
    }

    /**
     * The components reachable from the seeds, ordered by id. Stamps each visited road tile's
     * component id, gathering the prior ids into `affected`.
     * @param {Iterable<RoadTile>} seeds
     * @param {Set<number>|null} affected
     * @returns {RoadComponent[]}
     */
    componentsFrom(seeds, affected) {
        const seen = new Set();
        const seenHousings = new Set();
        const components = [];
        for (const seed of seeds) {
            if (seen.has(seed.key)) {
                continue;
            }
            seen.add(seed.key);
            this._notePriorComponent(seed, affected);
            const component = new RoadComponent(seed);
            floodRoadComponent({
                seed,
                roadTiles: this._tiles,
                seen,
                housingAt: (x, y) => {
                    const housing = this.housingAt(x, y);
                    if (housing === null || seenHousings.has(housing.objectId)) {
                        return null;
                    }
                    seenHousings.add(housing.objectId);
                    return housing;
                },
                onRoad: (road) => {
                    this._notePriorComponent(road, affected);
                    component.addTile(road);
                },
                onHousing: (housing) => component.housings.push(housing),
            });
            components.push(component);
        }
        components.sort((a, b) => a.minTile - b.minTile);
        for (const component of components) {
            component.stamp();
        }
        return components;
    }

    /**
     * @private
     * @param {RoadTile} road
     * @param {Set<number>|null} affected
     * @returns {void}
     */
    _notePriorComponent(road, affected) {
        if (affected !== null && road.component !== null) {
            affected.add(road.component);
        }
    }

    /**
     * Re-registers every placed road's cells after a load, leaving the whole allocation stale.
     * @returns {void}
     */
    rebuild() {
        this._tiles = new Map();
        const def = this.placed.def;
        for (let row = 0; row < def.count; row += 1) {
            const behavior = this.placed.behaviorFor(def.store.typeId[row]);
            if (!(behavior instanceof RoadBehavior)) {
                continue;
            }
            const objectId = def.store.objectId[row];
            for (const cell of this.footprintOf(behavior, def.eids[row])) {
                this.addRoad(cell.x, cell.y, objectId);
            }
        }
        this._dirtyAll = true;
    }
}
