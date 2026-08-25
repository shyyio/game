import {Sprite, Texture} from "pixi.js";
import {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
import {DisplayPool} from "@/client/layers/DisplayPool.js";
import {KeyedDisplayPool} from "@/client/layers/KeyedDisplayPool.js";
import {isWorkerBehavior} from "@/sim/behaviors/RoadBehavior.js";
import {findCommuteRoute} from "@/client/layers/workerRoute.js";
import {WorkerAssignmentsView} from "@/client/state/WorkerAssignmentsState.js";

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

// Route BFS runs per rebuilt machine each frame; capped so a loading burst can't stall the frame.
const ROUTE_REBUILDS_PER_TICK = 20;

// Figures are cosmetic, so they advance at this cadence rather than every frame; each pass repacks
// the layer's batch.
const WORKER_ADVANCE_INTERVAL_MS = 1000 / 12;

// At most this many figures render, nearest the viewport center first; the rest freeze invisible
// so the layer's per-frame repack stays bounded however many machines are manned.
const WORKER_RENDER_CAP = 300;

// How often the rendered set re-derives from the viewport center.
const WORKER_CULL_INTERVAL_MS = 300;

/**
 * Walking worker figures, one per manned machine, commuting between the machine and the nearest
 * housing of its network. Purely cosmetic: driven by the shared assignment index; the route is a
 * client-side BFS over the road/housing entries and re-derives whenever the cache changes.
 */
export class WorkerDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ClientCache} state
     */
    constructor(state) {
        super();
        /**
         * The shared machine-staffing view; unmanned assignments carry no figure.
         * @type {WorkerAssignmentsView}
         * @private
         */
        this._assignments = state.view("workerAssignments");
        state.subscribe("workerAssignments.byMachine", machineId => this._onAssignmentChange(machineId));
        /**
         * Live figures keyed by machineId. Idle figures await reuse as invisible children,
         * capped at the render cap, since no more could ever show at once.
         * @type {KeyedDisplayPool}
         * @private
         */
        this._workers = new KeyedDisplayPool(new DisplayPool(
            () => {
                const worker = new WorkerSprite(this._walkFrames()[0]);
                this.addChild(worker);
                return worker;
            },
            worker => {
                worker.visible = false;
            },
            worker => {
                worker.visible = true;
            },
            WORKER_RENDER_CAP,
        ));
        // Routes re-derive after any worker-relevant cache change, spread over ticks and drained
        // ROUTE_REBUILDS_PER_TICK per frame: assignment changes queue their machine as urgent; the
        // flag requeues every assignment as background work, served only with leftover budget so
        // a world-wide refresh never delays freshly visible machines.
        this._routesStale = false;
        this._dirtyMachines = new Set();
        this._staleMachines = new Set();
        // Machines whose assignment arrived via chunk sync: their fresh figure scatters
        // mid-commute; a live-manned machine's figure departs from its housing instead.
        this._scatterMachines = new Set();
        // Carried since the last figure advance.
        this._pendingDeltaMS = 0;
        // Counts down to the next cull pass.
        this._cullCountdownMS = 0;
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
     * Tracks an assignment change; the figure itself (re)builds on the next tick.
     * @param {number} machineId
     * @returns {void}
     * @private
     */
    _onAssignmentChange(machineId) {
        const assignment = this._assignments.get(machineId);
        if (assignment === undefined || !WorkerAssignmentsView.manned(assignment)) {
            this._dirtyMachines.delete(machineId);
            this._staleMachines.delete(machineId);
            this._scatterMachines.delete(machineId);
            this._workers.release(machineId);
            return;
        }
        if (assignment.synced) {
            this._scatterMachines.add(machineId);
        }
        this._dirtyMachines.add(machineId);
    }

    /**
     * Marks routes stale when a road/housing/staffed-machine entry appears or disappears; other
     * cache traffic (belts, decorations) never reroutes a commute.
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheChange(entry) {
        const behavior = entry.behavior;
        if (behavior !== null && isWorkerBehavior(behavior)) {
            this._routesStale = true;
        }
    }

    /**
     * Re-derives stale routes, then advances every figure's commute and walk frame.
     * @param {number} frame current animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks unused — figures cull by viewport distance
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        if (this._routesStale) {
            this._routesStale = false;
            for (const [, assignment] of this._assignments.entries()) {
                if (WorkerAssignmentsView.manned(assignment)) {
                    this._staleMachines.add(assignment.machineId);
                }
            }
        }
        let budget = ROUTE_REBUILDS_PER_TICK;
        for (const machineId of this._dirtyMachines) {
            if (budget === 0) {
                break;
            }
            budget -= 1;
            this._dirtyMachines.delete(machineId);
            // An urgent rebuild also satisfies a pending background one.
            this._staleMachines.delete(machineId);
            this._rebuildRoute(machineId);
        }
        for (const machineId of this._staleMachines) {
            if (budget === 0) {
                break;
            }
            budget -= 1;
            this._staleMachines.delete(machineId);
            this._rebuildRoute(machineId);
        }
        this._cullCountdownMS -= deltaMS;
        if (this._cullCountdownMS <= 0) {
            this._cullCountdownMS = WORKER_CULL_INTERVAL_MS;
            this._cull();
        }
        this._pendingDeltaMS += deltaMS;
        if (this._pendingDeltaMS < WORKER_ADVANCE_INTERVAL_MS) {
            return;
        }
        for (const worker of this._workers.values()) {
            if (!worker.visible) {
                continue;
            }
            worker.advance(this._pendingDeltaMS);
            let walkFrame;
            if (worker.moving) {
                walkFrame = frame;
            } else {
                walkFrame = 0;
            }
            worker.texture = this._walkFrames()[walkFrame];
        }
        this._pendingDeltaMS = 0;
    }

    /**
     * Shows the WORKER_RENDER_CAP figures nearest the viewport center and freezes the rest
     * invisible until a later pass brings them back.
     * @private
     * @returns {void}
     */
    _cull() {
        if (this._workers.size <= WORKER_RENDER_CAP) {
            for (const worker of this._workers.values()) {
                worker.visible = true;
            }
            return;
        }
        const center = this.viewport.center;
        const ranked = [...this._workers.values()];
        for (const worker of ranked) {
            const dx = worker.x - center.x;
            const dy = worker.y - center.y;
            worker.cullDistance = dx * dx + dy * dy;
        }
        ranked.sort((a, b) => a.cullDistance - b.cullDistance);
        for (let i = 0; i < ranked.length; i += 1) {
            ranked[i].visible = i < WORKER_RENDER_CAP;
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
     * Rebuilds one assignment's route off the current cache; an assignment whose machine or route
     * to a housing is not (or no longer) cached loses its figure until the cache changes again.
     * @private
     * @param {number} machineId
     * @returns {void}
     */
    _rebuildRoute(machineId) {
        const assignment = this._assignments.get(machineId);
        if (assignment === undefined || !WorkerAssignmentsView.manned(assignment)) {
            this._workers.release(machineId);
            return;
        }
        const machineEntry = this.cache.get(machineId);
        const waypoints = machineEntry === null
            ? null
            : findCommuteRoute(this.cache, machineEntry);
        if (waypoints === null) {
            this._workers.release(machineId);
            return;
        }
        const fresh = !this._workers.has(machineId);
        const scatter = this._scatterMachines.delete(machineId);
        const worker = this._workers.take(machineId);
        worker.setRoute(waypoints);
        if (fresh) {
            if (scatter) {
                worker.scatter();
            } else {
                worker.depart();
            }
        }
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
        // Squared distance to the viewport center, written by the layer's cull pass.
        this.cullDistance = 0;
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
     * Starts a fresh figure at its housing, about to walk out for its first shift. Call after
     * {@link setRoute}.
     * @returns {void}
     */
    depart() {
        this._walked = 0;
        this._forward = 1;
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
