import {Container, Graphics, GraphicsContext} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {DisplayPool} from "@/client/DisplayPool.js";
import {TILE_SIZE} from "@/client/constants.js";
import {chunkId, getOrCreate} from "@/common/util.js";

// Worker dot styling, in a row along the machine's top edge: every slot carries the same solid
// black ring; a granted worker fills it green, a missing one yellow.
const DOT_GRANTED_COLOR = 0x7fdd7f;
const DOT_MISSING_COLOR = 0xf2c80a;
const DOT_OUTLINE_COLOR = 0x000000;
const DOT_OUTLINE_WIDTH = 1.2;
const DOT_RADIUS = 4;
const DOT_SPACING = 11;
const DOT_EDGE_INSET = 8;
const DOT_LEFT_INSET = DOT_EDGE_INSET + 3;

// Idle badges kept per staffing state; overflow is destroyed instead of parked.
const BADGE_POOL_LIMIT = 64;

/**
 * At-a-glance staffing badges: a road-attached machine shows one dot slot per worker it needs (its
 * laborCost), filled green per worker granted and yellow for the shortfall.
 * Machines with no road attachment show nothing.
 */
export class LaborBadgeLayer extends AbstractDrawLayer {

    /**
     * @param {LaborAssignmentCache} assignments
     */
    constructor(assignments) {
        super();
        /**
         * The shared machine-staffing index.
         * @type {LaborAssignmentCache}
         * @private
         */
        this._assignments = assignments;
        assignments.onChange(machineId => this._onAssignmentChange(machineId));
        /**
         * Live badges keyed by machineId.
         * @type {Map<number, Badge>}
         * @private
         */
        this._badges = new Map();
        /**
         * Idle badges awaiting reuse, detached, pooled by staffing state: a badge keeps its
         * shared context for life, because every context (re)assignment registers/removes a
         * listener on the context's list — O(all badges) per swap on a shared context.
         * @type {Map<string, DisplayPool>}
         * @private
         */
        this._pools = new Map();
        /**
         * Shared dot-row geometry, keyed "workers:granted" — every badge in the same staffing
         * state draws the same context, so placing a badge triangulates nothing.
         * @type {Map<string, GraphicsContext>}
         * @private
         */
        this._contexts = new Map();
        /**
         * Per-chunk badge containers.
         * @type {Map<number, BadgeChunkContainer>}
         * @private
         */
        this._chunkContainers = new Map();
        // Machines whose badge rebuilds on the next tick; a badge depends only on its machine's
        // own entry and granted count, so road/housing churn never touches it.
        this._dirtyMachines = new Set();
    }

    get layerIndex() {
        // Above the object sprites (20), so dots read over the machine art.
        return 21;
    }

    /**
     * @param {number} machineId
     * @returns {void}
     * @private
     */
    _onAssignmentChange(machineId) {
        if (this._assignments.get(machineId) === null) {
            this._releaseBadge(machineId);
            this._dirtyMachines.delete(machineId);
            return;
        }
        this._dirtyMachines.add(machineId);
    }

    /**
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheChange(entry) {
        if (this._assignments.has(entry.id)) {
            this._dirtyMachines.add(entry.id);
        }
    }

    /**
     * Rebuilds the dirty badges; hidden (map mode), the backlog waits for the zoom back in.
     * @param {number} frame
     * @param {number} deltaMS
     * @param {Set<number>} visibleChunks
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {
        if (!this.visible) {
            return;
        }
        for (const machineId of this._dirtyMachines) {
            const assignment = this._assignments.get(machineId);
            const entry = assignment === null ? null : this.cache.get(machineId);
            if (entry === null) {
                this._releaseBadge(machineId);
                continue;
            }
            this._placeBadge(machineId, entry, assignment.workers);
        }
        this._dirtyMachines.clear();
    }

    /**
     * Draws one dot slot per needed worker along the machine footprint's top-left corner: filled
     * green per granted worker, yellow for each missing one.
     * @private
     * @param {number} machineId
     * @param {CacheEntry} entry
     * @param {number} granted
     * @returns {void}
     */
    _placeBadge(machineId, entry, granted) {
        const workers = entry.behavior.laborCost;
        const stateKey = `${workers}:${granted}`;
        let badge = this._badges.get(machineId);
        if (badge !== undefined && badge.stateKey !== stateKey) {
            // Staffing changed: swap the whole badge, so contexts never reassign.
            this._releaseBadge(machineId);
            badge = undefined;
        }
        if (badge === undefined) {
            badge = this._poolFor(stateKey).take(workers, granted);
            this._badges.set(machineId, badge);
        }

        const bounds = entry.tileBounds;
        badge.position.set(
            bounds.minTileX * TILE_SIZE + DOT_LEFT_INSET,
            bounds.minTileY * TILE_SIZE + DOT_EDGE_INSET,
        );
        const container = this._containerFor(chunkId(bounds.minTileX, bounds.minTileY));
        if (badge.parent !== container) {
            container.addChild(badge);
        }
    }

    /**
     * The badge pool for a staffing state, created on first use. Fresh badges build against the
     * state's shared context; park/attach is the caller's, so park and revive are no-ops.
     * @private
     * @param {string} stateKey
     * @returns {DisplayPool}
     */
    _poolFor(stateKey) {
        return getOrCreate(this._pools, stateKey, () => new DisplayPool(
            (workers, granted) => new Badge(
                this._contextFor(stateKey, workers, granted),
                stateKey,
            ),
            badge => {},
            badge => {},
            BADGE_POOL_LIMIT,
        ));
    }

    /**
     * The shared dot-row context for a staffing state, built on first use.
     * @private
     * @param {string} stateKey
     * @param {number} workers
     * @param {number} granted
     * @returns {GraphicsContext}
     */
    _contextFor(stateKey, workers, granted) {
        return getOrCreate(this._contexts, stateKey, () => {
            const context = new GraphicsContext();
            for (let i = 0; i < workers; i += 1) {
                context
                    .circle(i * DOT_SPACING, 0, DOT_RADIUS)
                    .fill(i < granted ? DOT_GRANTED_COLOR : DOT_MISSING_COLOR)
                    .stroke({color: DOT_OUTLINE_COLOR, width: DOT_OUTLINE_WIDTH});
            }
            return context;
        });
    }

    /**
     * The badge container for a chunk, created on first use.
     * @private
     * @param {number} chunk
     * @returns {BadgeChunkContainer}
     */
    _containerFor(chunk) {
        return getOrCreate(this._chunkContainers, chunk, () => {
            const container = new BadgeChunkContainer(chunk);
            this.addChild(container);
            return container;
        });
    }

    /**
     * Parks a machine's badge back in its state's pool, detached; a no-op when it has none. An
     * emptied chunk container dies with its last badge.
     * @private
     * @param {number} machineId
     * @returns {void}
     */
    _releaseBadge(machineId) {
        const badge = this._badges.get(machineId);
        if (badge === undefined) {
            return;
        }
        const container = badge.parent;
        container.removeChild(badge);
        if (container.children.length === 0) {
            this._chunkContainers.delete(container.chunk);
            this.removeChild(container);
            container.destroy();
        }
        this._badges.delete(machineId);
        // An overflow destroy() leaves the shared context alone (the badge never owned it).
        this._poolFor(badge.stateKey).release(badge);
    }
}

/**
 * One machine's dot-row badge, drawing its staffing state's shared context.
 */
class Badge extends Graphics {

    /**
     * @param {GraphicsContext} context
     * @param {string} stateKey
     */
    constructor(
        context,
        stateKey,
    ) {
        super(context);
        this.stateKey = stateKey;
    }
}

/**
 * One chunk's badges, its own render group so a loading chunk's badges repack only that chunk.
 */
class BadgeChunkContainer extends Container {

    /**
     * @param {number} chunk
     */
    constructor(chunk) {
        super();
        this.isRenderGroup = true;
        this.chunk = chunk;
    }
}
