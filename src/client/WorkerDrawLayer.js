import {Sprite} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";
import {LAYER_SURFACE} from "@/common/constants.js";
import {tileId} from "@/common/util.js";
import {RoadBehavior} from "@/common/sim/behaviors.js";
import {LaborAssignmentEvent, NO_HOUSING} from "@/common/LaborEvents.js";

// Spritesheet base of the 8-frame walk cycle.
const WORKER_ANIMATION = "worker-walk";

// Walk pace in world px per second (TILE_SIZE px = one tile).
const WALK_SPEED = 25;

// Figure sprite scale (the atlas art is drawn at tile scale; workers stand about a half-tile).
const WORKER_SCALE = 0.8;

// Standing pauses at the commute's ends (a base plus a random spread, so figures on the same road
// desynchronize): a long shift inside the machine, a short stop back at the housing.
const MACHINE_PAUSE_MIN_MS = 9000;
const MACHINE_PAUSE_JITTER_MS = 8000;
const HOUSING_PAUSE_MIN_MS = 600;
const HOUSING_PAUSE_JITTER_MS = 1600;

// How far a figure wanders off the path center, world px each side.
const LATERAL_RANGE = 7;

// Route BFS runs per rebuilt machine each tick; capped so a loading burst can't stall the frame.
const ROUTE_REBUILDS_PER_TICK = 50;

// 4-neighborhood shared with the sim's road flood fill.
const NEIGHBOR_DELTAS = [
    {dx: 1, dy: 0},
    {dx: -1, dy: 0},
    {dx: 0, dy: 1},
    {dx: 0, dy: -1},
];

/**
 * Walking worker figures, one per manned machine, commuting along the cached road tiles between
 * the machine's housing and the machine. Purely cosmetic: driven by LaborAssignmentEvents; the
 * route is a client-side BFS over the road entries and re-derives whenever the cache changes.
 */
export class WorkerDrawLayer extends AbstractDrawLayer {

    constructor() {
        super();
        /**
         * machineId -> housingId for every manned machine in watched chunks.
         * @type {Map<number, number>}
         * @private
         */
        this._assignments = new Map();
        /**
         * Live figures keyed by machineId.
         * @type {Map<number, WorkerSprite>}
         * @private
         */
        this._workers = new Map();
        /**
         * Idle figures awaiting reuse, kept as invisible children.
         * @type {WorkerSprite[]}
         * @private
         */
        this._pool = [];
        // Routes re-derive after any labor-relevant cache change, spread over ticks: the flag
        // queues every assignment, the set drains ROUTE_REBUILDS_PER_TICK per tick.
        this._routesStale = false;
        this._dirtyMachines = new Set();
        /**
         * The walk-cycle textures, resolved from the registry on first use.
         * @type {Texture[]|null}
         * @private
         */
        this._frames = null;
    }

    get layerIndex() {
        // Above the road layer (18), below the object sprites (20): figures walk over roads and
        // disappear behind the machine/housing they enter.
        return 19;
    }

    /**
     * Hides workers in map mode.
     * @param {boolean} value
     */
    set mapMode(value) {
        this.visible = !value;
    }

    /**
     * Subscribes to the shared cache; the client calls this once when it builds the layer.
     * @param {ClientCache} cache
     * @returns {void}
     */
    bindCache(cache) {
        cache.onSet(entry => this._onCacheChange(entry));
        cache.onRemove(entry => this._onCacheChange(entry));
    }

    get eventClasses() {
        return [LaborAssignmentEvent];
    }

    /**
     * Tracks an assignment change; the figure itself (re)builds on the next tick.
     * @param {LaborAssignmentEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event.housingId === NO_HOUSING) {
            this._assignments.delete(event.machineId);
            this._releaseWorker(event.machineId);
            return;
        }
        this._assignments.set(event.machineId, event.housingId);
        this._dirtyMachines.add(event.machineId);
    }

    /**
     * Marks routes stale when a road/housing/labor-machine entry appears or disappears; other
     * cache traffic (belts, decorations) never reroutes a commute.
     * @private
     * @param {CacheEntry} entry
     * @returns {void}
     */
    _onCacheChange(entry) {
        const type = entry.data.type;
        if (type === undefined || type.behavior === null) {
            return;
        }
        const behavior = type.behavior;
        if (behavior instanceof RoadBehavior || behavior.laborSupply > 0 || behavior.laborCost > 0) {
            this._routesStale = true;
        }
    }

    /**
     * Re-derives stale routes, then advances every figure's commute and walk frame.
     * @param {number} frame current animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @returns {void}
     */
    tick(frame, deltaMS) {
        if (this._routesStale) {
            this._routesStale = false;
            for (const machineId of this._assignments.keys()) {
                this._dirtyMachines.add(machineId);
            }
        }
        let budget = ROUTE_REBUILDS_PER_TICK;
        for (const machineId of this._dirtyMachines) {
            if (budget === 0) {
                break;
            }
            budget -= 1;
            this._dirtyMachines.delete(machineId);
            this._rebuildRoute(machineId);
        }
        for (const worker of this._workers.values()) {
            worker.advance(deltaMS);
            worker.texture = this._walkFrames()[worker.moving ? frame : 0];
        }
    }

    /**
     * @private
     * @returns {Texture[]}
     */
    _walkFrames() {
        if (this._frames === null) {
            const frames = this.textureRegistry.getAnimation(WORKER_ANIMATION);
            if (frames === undefined) {
                throw new Error(`Missing "${WORKER_ANIMATION}" animation frames in the atlas`);
            }
            this._frames = frames;
        }
        return this._frames;
    }

    /**
     * Rebuilds one assignment's route off the current cache; an assignment whose machine, housing,
     * or road path is not (or no longer) cached loses its figure until the cache changes again.
     * @private
     * @param {number} machineId
     * @returns {void}
     */
    _rebuildRoute(machineId) {
        const housingId = this._assignments.get(machineId);
        if (housingId === undefined) {
            this._releaseWorker(machineId);
            return;
        }
        const machineEntry = this.cache.get(machineId);
        const housingEntry = this.cache.get(housingId);
        const waypoints = machineEntry === null || housingEntry === null
            ? null
            : this._findRoute(housingEntry, machineEntry);
        if (waypoints === null) {
            this._releaseWorker(machineId);
            return;
        }
        let worker = this._workers.get(machineId);
        const fresh = worker === undefined;
        if (fresh) {
            worker = this._pool.pop();
            if (worker === undefined) {
                worker = new WorkerSprite(this._walkFrames()[0]);
                this.addChild(worker);
            }
            worker.visible = true;
            this._workers.set(machineId, worker);
        }
        worker.setRoute(waypoints);
        if (fresh) {
            worker.scatter();
        }
    }

    /**
     * The road entry covering a tile, or null when the tile holds none.
     * @private
     * @param {number} x
     * @param {number} y
     * @returns {CacheEntry|null}
     */
    _roadAt(x, y) {
        const entry = this.cache.at(x, y, LAYER_SURFACE);
        if (entry === null || entry.data.type === undefined || entry.data.type.behavior === null) {
            return null;
        }
        return entry.data.type.behavior instanceof RoadBehavior ? entry : null;
    }

    /**
     * BFS over the cached road tiles from the housing's edge to the machine's edge; the shortest
     * route as world-px waypoints (housing center, road tile centers, machine center), or null
     * when no cached road connects them.
     * @private
     * @param {CacheEntry} housingEntry
     * @param {CacheEntry} machineEntry
     * @returns {{x: number, y: number}[]|null}
     */
    _findRoute(housingEntry, machineEntry) {
        const targets = new Set();
        for (const cell of machineEntry.cells) {
            for (const delta of NEIGHBOR_DELTAS) {
                const x = cell.x + delta.dx;
                const y = cell.y + delta.dy;
                if (this._roadAt(x, y) !== null) {
                    targets.add(tileId(x, y));
                }
            }
        }
        if (targets.size === 0) {
            return null;
        }

        // parent: road tile -> the road tile it was reached from (null for a seed by the housing).
        const parents = new Map();
        const queue = [];
        for (const cell of housingEntry.cells) {
            for (const delta of NEIGHBOR_DELTAS) {
                const x = cell.x + delta.dx;
                const y = cell.y + delta.dy;
                const tile = tileId(x, y);
                if (parents.has(tile) || this._roadAt(x, y) === null) {
                    continue;
                }
                parents.set(tile, null);
                queue.push({x, y, tile});
            }
        }

        let goal = null;
        for (let head = 0; head < queue.length && goal === null; head += 1) {
            const current = queue[head];
            if (targets.has(current.tile)) {
                goal = current;
                break;
            }
            for (const delta of NEIGHBOR_DELTAS) {
                const x = current.x + delta.dx;
                const y = current.y + delta.dy;
                const tile = tileId(x, y);
                if (parents.has(tile) || this._roadAt(x, y) === null) {
                    continue;
                }
                parents.set(tile, current);
                queue.push({x, y, tile});
            }
        }
        if (goal === null) {
            return null;
        }

        const waypoints = [WorkerDrawLayer._entryCenter(machineEntry)];
        for (let node = goal; node !== null; node = parents.get(node.tile)) {
            waypoints.push({
                x: node.x * TILE_SIZE + TILE_SIZE / 2,
                y: node.y * TILE_SIZE + TILE_SIZE / 2,
            });
        }
        waypoints.push(WorkerDrawLayer._entryCenter(housingEntry));
        waypoints.reverse();
        return waypoints;
    }

    /**
     * The world-px center of an entry's footprint.
     * @private
     * @param {CacheEntry} entry
     * @returns {{x: number, y: number}}
     */
    static _entryCenter(entry) {
        let sumX = 0;
        let sumY = 0;
        for (const cell of entry.cells) {
            sumX += cell.x;
            sumY += cell.y;
        }
        return {
            x: (sumX / entry.cells.length) * TILE_SIZE + TILE_SIZE / 2,
            y: (sumY / entry.cells.length) * TILE_SIZE + TILE_SIZE / 2,
        };
    }

    /**
     * Parks a machine's figure back in the pool; a no-op when it has none.
     * @private
     * @param {number} machineId
     * @returns {void}
     */
    _releaseWorker(machineId) {
        const worker = this._workers.get(machineId);
        if (worker === undefined) {
            return;
        }
        worker.visible = false;
        this._workers.delete(machineId);
        this._pool.push(worker);
    }
}

/**
 * One commuting figure: walks its waypoint route end to end, pauses at each end (a shift
 * handover), then walks back, facing its direction of travel.
 */
class WorkerSprite extends Sprite {

    /**
     * @param {Texture} texture
     */
    constructor(texture) {
        super(texture);
        this.anchor = 0.5;
        this.scale.set(WORKER_SCALE);
        // Route state: waypoints, cumulative segment lengths, walked px, travel sign, pause left,
        // and this figure's sideways drift off the path center.
        this._waypoints = [];
        this._cumulative = [];
        this._totalLength = 0;
        this._walked = 0;
        this._forward = 1;
        this._pauseMS = 0;
        this._lateral = 0;
        this.moving = false;
    }

    /**
     * Drops a fresh figure at a random point of its commute cycle — position, direction, and a
     * random initial hold — so a freshly loaded chunk shows staggered commutes, not a synchronized
     * wave leaving the housings. Call after {@link setRoute}.
     * @returns {void}
     */
    scatter() {
        this._walked = Math.random() * this._totalLength;
        this._forward = Math.random() < 0.5 ? 1 : -1;
        this._pauseMS = Math.random() * HOUSING_PAUSE_JITTER_MS;
        this._rollLateral();
        this._place();
    }

    /**
     * @private
     * @returns {void}
     */
    _rollLateral() {
        this._lateral = (Math.random() * 2 - 1) * LATERAL_RANGE;
    }

    /**
     * Adopts a (re-derived) route, keeping the figure's walked distance so a reroute doesn't
     * teleport it back to the housing.
     * @param {{x: number, y: number}[]} waypoints
     * @returns {void}
     */
    setRoute(waypoints) {
        this._waypoints = waypoints;
        this._cumulative = [0];
        let length = 0;
        for (let i = 1; i < waypoints.length; i += 1) {
            length += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].y - waypoints[i - 1].y);
            this._cumulative.push(length);
        }
        this._totalLength = length;
        this._walked = Math.min(this._walked, length);
        this._place();
    }

    /**
     * Advances the commute: walk, pause at an end, turn around.
     * @param {number} deltaMS
     * @returns {void}
     */
    advance(deltaMS) {
        if (this._totalLength === 0) {
            this.moving = false;
            return;
        }
        if (this._pauseMS > 0) {
            this._pauseMS -= deltaMS;
            this.moving = false;
            return;
        }
        this.moving = true;
        this._walked += this._forward * WALK_SPEED * (deltaMS / 1000);
        if (this._walked >= this._totalLength) {
            // Arrived at the machine: work the shift, then walk back.
            this._walked = this._totalLength;
            this._forward = -1;
            this._turnAround(MACHINE_PAUSE_MIN_MS, MACHINE_PAUSE_JITTER_MS);
        } else if (this._walked <= 0) {
            this._walked = 0;
            this._forward = 1;
            this._turnAround(HOUSING_PAUSE_MIN_MS, HOUSING_PAUSE_JITTER_MS);
        }
        this._place();
    }

    /**
     * A stop at a commute end: random pause length and a fresh drift for the walk back.
     * @private
     * @param {number} minMS
     * @param {number} jitterMS
     * @returns {void}
     */
    _turnAround(minMS, jitterMS) {
        this._pauseMS = minMS + Math.random() * jitterMS;
        this._rollLateral();
    }

    /**
     * Positions the sprite at its walked distance along the route, drifted sideways off the path
     * center, facing its travel direction.
     * @private
     * @returns {void}
     */
    _place() {
        if (this._waypoints.length === 0) {
            return;
        }
        let segment = 1;
        while (segment < this._cumulative.length - 1 && this._cumulative[segment] < this._walked) {
            segment += 1;
        }
        const from = this._waypoints[segment - 1];
        const to = this._waypoints[segment];
        const segmentLength = this._cumulative[segment] - this._cumulative[segment - 1];
        const t = segmentLength === 0 ? 0 : (this._walked - this._cumulative[segment - 1]) / segmentLength;
        this.x = from.x + t * (to.x - from.x);
        this.y = from.y + t * (to.y - from.y);
        // Drift sideways off the segment's centerline.
        const segDX = to.x - from.x;
        const segDY = to.y - from.y;
        if (segmentLength > 0) {
            this.x += (-segDY / segmentLength) * this._lateral;
            this.y += (segDX / segmentLength) * this._lateral;
        }
        // Face the direction of travel; a vertical leg keeps the last horizontal facing.
        const dx = segDX * this._forward;
        if (dx !== 0) {
            this.scale.x = dx < 0 ? -Math.abs(this.scale.x) : Math.abs(this.scale.x);
        }
    }
}
