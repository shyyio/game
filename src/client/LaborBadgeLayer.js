import {Container, Graphics, GraphicsContext} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";
import {chunkId} from "@/common/util.js";
import {LaborAssignmentEvent} from "@/common/LaborEvents.js";

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

/**
 * At-a-glance staffing badges: a road-attached machine shows one dot slot per worker it needs (its
 * laborCost), filled green per worker granted and yellow for the shortfall.
 * Machines with no road attachment show nothing.
 */
export class LaborBadgeLayer extends AbstractDrawLayer {

    constructor() {
        super();
        /**
         * machineId -> granted workers for every road-attached machine in watched chunks.
         * @type {Map<number, number>}
         * @private
         */
        this._assignments = new Map();
        /**
         * Live badges keyed by machineId.
         * @type {Map<number, Graphics>}
         * @private
         */
        this._badges = new Map();
        /**
         * Idle badges awaiting reuse, detached, pooled by staffing state: a badge keeps its
         * shared context for life, because every context (re)assignment registers/removes a
         * listener on the context's list — O(all badges) per swap on a shared context.
         * @type {Map<string, Graphics[]>}
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
         * Per-chunk badge containers, each its own render group so a loading chunk's badges
         * repack only that chunk.
         * @type {Map<number, Container>}
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
     * Hides badges in map mode.
     * @param {boolean} value
     */
    set mapMode(value) {
        this.visible = !value;
    }

    get eventClasses() {
        return [LaborAssignmentEvent];
    }

    /**
     * @param {LaborAssignmentEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event.attached === 0) {
            this._assignments.delete(event.machineId);
            this._releaseBadge(event.machineId);
            return;
        }
        this._assignments.set(event.machineId, event.workers);
        this._dirtyMachines.add(event.machineId);
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

    /**
     * @private
     * @param {CacheEntry} entry
     * @returns {void}
     */
    _onCacheChange(entry) {
        if (this._assignments.has(entry.id)) {
            this._dirtyMachines.add(entry.id);
        }
    }

    /**
     * Rebuilds the dirty badges.
     * @param {number} frame
     * @param {number} deltaMS
     * @returns {void}
     */
    tick(frame, deltaMS) {
        for (const machineId of this._dirtyMachines) {
            const granted = this._assignments.get(machineId);
            const entry = granted === undefined ? null : this.cache.get(machineId);
            if (entry === null) {
                this._releaseBadge(machineId);
                continue;
            }
            this._placeBadge(machineId, entry, granted);
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
        const workers = entry.data.type.behavior.laborCost;
        const stateKey = `${workers}:${granted}`;
        let badge = this._badges.get(machineId);
        if (badge !== undefined && badge.stateKey !== stateKey) {
            // Staffing changed: swap the whole badge, so contexts never reassign.
            this._releaseBadge(machineId);
            badge = undefined;
        }
        if (badge === undefined) {
            badge = this._takeBadge(stateKey, workers, granted);
            this._badges.set(machineId, badge);
        }

        let minX = entry.cells[0].x;
        let minY = entry.cells[0].y;
        for (const cell of entry.cells) {
            minX = Math.min(minX, cell.x);
            minY = Math.min(minY, cell.y);
        }
        badge.position.set(minX * TILE_SIZE + DOT_LEFT_INSET, minY * TILE_SIZE + DOT_EDGE_INSET);
        const container = this._containerFor(chunkId(minX, minY));
        if (badge.parent !== container) {
            container.addChild(badge);
        }
    }

    /**
     * A pooled badge for a staffing state, created against the state's shared context when the
     * pool is dry.
     * @private
     * @param {string} stateKey
     * @param {number} workers
     * @param {number} granted
     * @returns {Graphics}
     */
    _takeBadge(stateKey, workers, granted) {
        const pool = this._pools.get(stateKey);
        const pooled = pool === undefined ? undefined : pool.pop();
        if (pooled !== undefined) {
            return pooled;
        }
        const badge = new Graphics(this._contextFor(stateKey, workers, granted));
        badge.stateKey = stateKey;
        return badge;
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
        let context = this._contexts.get(stateKey);
        if (context === undefined) {
            context = new GraphicsContext();
            for (let i = 0; i < workers; i += 1) {
                context
                    .circle(i * DOT_SPACING, 0, DOT_RADIUS)
                    .fill(i < granted ? DOT_GRANTED_COLOR : DOT_MISSING_COLOR)
                    .stroke({color: DOT_OUTLINE_COLOR, width: DOT_OUTLINE_WIDTH});
            }
            this._contexts.set(stateKey, context);
        }
        return context;
    }

    /**
     * The badge container for a chunk, created on first use.
     * @private
     * @param {number} chunk
     * @returns {Container}
     */
    _containerFor(chunk) {
        let container = this._chunkContainers.get(chunk);
        if (container === undefined) {
            container = new Container();
            container.isRenderGroup = true;
            container.badgeChunk = chunk;
            this._chunkContainers.set(chunk, container);
            this.addChild(container);
        }
        return container;
    }

    /**
     * Parks a machine's badge back in the pool, detached; a no-op when it has none. An emptied
     * chunk container dies with its last badge.
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
            this._chunkContainers.delete(container.badgeChunk);
            this.removeChild(container);
            container.destroy();
        }
        this._badges.delete(machineId);
        let pool = this._pools.get(badge.stateKey);
        if (pool === undefined) {
            pool = [];
            this._pools.set(badge.stateKey, pool);
        }
        pool.push(badge);
    }
}
