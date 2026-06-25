import {
    AbstractDrawLayer,
    Graphics,
    TILE_SIZE,
    DEBUG_COLOR,
    drawLine,
    drawCircle,
} from "@/sdk/client.js";

// Radius of the circle marking a path's head and tail belts.
const END_MARKER_RADIUS = 10;

/**
 * Debug overlay drawing each belt path as a colored line (keyed by its head belt
 * id) with a circle on the head and tail. Hidden until debug mode is enabled.
 */
export class PathDebugDrawLayer extends AbstractDrawLayer {

    /**
     * @param {ViewportCache} beltCache - shared belt index, read for tile positions
     */
    constructor(beltCache) {
        super();
        this.visible = false;
        this._beltCache = beltCache;
        this._debugMode = false;
        // Map mode (zoomed far out) swaps sprites for low-res geometry; the overlay
        // is too fine to read there, so it hides regardless of debug mode.
        this._lowRes = false;
        /**
         * Belt ids in path order (head last), keyed by the head belt id.
         * @type {Map<BigInt, BigInt[]>}
         * @private
         */
        this._paths = new Map();
        this._graphics = new Graphics();
        this.addChild(this._graphics);
    }

    get layerIndex() {
        return 100;
    }

    /**
     * Shows the overlay in debug mode; hides it otherwise.
     * @param {boolean} enabled
     * @returns {void}
     */
    setDebugMode(enabled) {
        this._debugMode = enabled;
        this._updateVisibility();
    }

    /**
     * Hides the overlay in map mode (low-res), restoring it on zoom-in if debug mode is on.
     * @param {boolean} value
     */
    set lowRes(value) {
        this._lowRes = value;
        this._updateVisibility();
    }

    /**
     * Visible only in debug mode and out of map mode; repaints when shown.
     * @private
     */
    _updateVisibility() {
        this.visible = this._debugMode && !this._lowRes;
        this.redraw();
    }

    /**
     * No-op: BeltClientMod drives this layer imperatively.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {}

    /**
     * Records a recalculated path under its head id, dropping any head it just absorbed by a merge.
     * @param {BigInt[]} parts - belt ids in path order, head last
     */
    updatePath(parts) {
        const head = parts[parts.length - 1];
        // A merge folds another path's head in as a mid-belt; drop its stale entry.
        parts.forEach(id => {
            if (id !== head) {
                this._paths.delete(id);
            }
        });
        this._paths.set(head, parts);
        this.redraw();
    }

    /**
     * Drops the path headed by @id (its head belt was removed); a no-op for non-heads.
     * @param {BigInt} id
     */
    removePath(id) {
        if (this._paths.delete(id)) {
            this.redraw();
        }
    }

    /**
     * Repaints every tracked path; skipped while hidden. Called when a path's belts
     * land in the cache, since a path recalc can arrive before its belt inserts.
     * @returns {void}
     */
    redraw() {
        if (!this.visible) {
            return;
        }
        this._graphics.clear();
        this._paths.forEach(parts => {
            this._drawPath(parts);
        });
    }

    /**
     * @param {BigInt[]} parts - belt ids in path order, head last
     * @private
     */
    _drawPath(parts) {
        const records = parts.map(id => this._beltCache.get(id));
        // A belt left the viewport (or was just deleted): wait for the next recalc.
        if (records.length === 0 || records.some(record => record === null)) {
            return;
        }
        const color = DEBUG_COLOR(parts[parts.length - 1]);
        const points = records.map(record => ({
            x: record.tileX * TILE_SIZE + TILE_SIZE / 2,
            y: record.tileY * TILE_SIZE + TILE_SIZE / 2,
        }));

        for (let i = 0; i < points.length - 1; i += 1) {
            drawLine(this._graphics, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, color);
        }

        drawCircle(this._graphics, points[0].x, points[0].y, END_MARKER_RADIUS, color);
        if (points.length > 1) {
            const end = points[points.length - 1];
            drawCircle(this._graphics, end.x, end.y, END_MARKER_RADIUS, color);
        }
    }
}
