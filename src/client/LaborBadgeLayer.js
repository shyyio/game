import {Graphics} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE} from "@/client/constants.js";
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
         * Idle badges awaiting reuse, kept as invisible children.
         * @type {Graphics[]}
         * @private
         */
        this._pool = [];
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
        let badge = this._badges.get(machineId);
        if (badge === undefined) {
            badge = this._pool.pop();
            if (badge === undefined) {
                badge = new Graphics();
                this.addChild(badge);
            }
            badge.visible = true;
            this._badges.set(machineId, badge);
        }
        badge.clear();

        const workers = entry.data.type.behavior.laborCost;
        let minX = entry.cells[0].x;
        let minY = entry.cells[0].y;
        for (const cell of entry.cells) {
            minX = Math.min(minX, cell.x);
            minY = Math.min(minY, cell.y);
        }
        const y = minY * TILE_SIZE + DOT_EDGE_INSET;
        const firstX = minX * TILE_SIZE + DOT_LEFT_INSET;
        for (let i = 0; i < workers; i += 1) {
            const x = firstX + i * DOT_SPACING;
            badge
                .circle(x, y, DOT_RADIUS)
                .fill(i < granted ? DOT_GRANTED_COLOR : DOT_MISSING_COLOR)
                .stroke({color: DOT_OUTLINE_COLOR, width: DOT_OUTLINE_WIDTH});
        }
    }

    /**
     * Parks a machine's badge back in the pool; a no-op when it has none.
     * @private
     * @param {number} machineId
     * @returns {void}
     */
    _releaseBadge(machineId) {
        const badge = this._badges.get(machineId);
        if (badge === undefined) {
            return;
        }
        badge.visible = false;
        this._badges.delete(machineId);
        this._pool.push(badge);
    }
}
