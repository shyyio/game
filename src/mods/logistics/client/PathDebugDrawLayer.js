import {
    AbstractDebugDrawLayer,
    Graphics,
    TILE_SIZE,
    DEBUG_COLOR,
    drawLine,
    drawCircle,
} from "@spup/sdk/client";

// Radius of the circle marking a path's head and tail belts.
const END_MARKER_RADIUS = 10;

/**
 * Debug overlay drawing each belt path as a colored line (keyed by head belt id) with end markers.
 */
export class PathDebugDrawLayer extends AbstractDebugDrawLayer {

    /**
     * @param {Map<number, number[]>} paths - shared head id → ordered belt ids (head last), owned by LogisticsClientMod
     */
    constructor(paths) {
        super();
        this._paths = paths;
        this._graphics = new Graphics();
        this.addChild(this._graphics);
    }

    get layerIndex() {
        return 100;
    }

    /**
     * Repaints every tracked path.
     * @private
     * @returns {void}
     */
    _repaint() {
        this._graphics.clear();
        for (const parts of this._paths.values()) {
            this._drawPath(parts);
        }
    }

    /**
     * @param {number[]} parts - belt ids in path order, head last
     * @private
     */
    _drawPath(parts) {
        const records = parts.map(id => this.cache.get(id));
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
