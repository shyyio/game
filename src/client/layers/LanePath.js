import {TILE_SIZE} from "@/client/constants.js";
import {Direction} from "@/common/constants.js";

// A bend turns a quarter circle about the inside corner of the tile it turns in.
const TURN_RADIUS = TILE_SIZE / 2;
const QUARTER_TURN = Math.PI / 2;

/**
 * One cell's stretch of a lane: the line or quarter arc items ride from the edge they enter over
 * to the edge they leave by.
 */
export class LanePathEntry {

    /**
     * @param {Object} stretch
     * @param {number} stretch.tileX - the cell this stretch crosses
     * @param {number} stretch.tileY
     * @param {Direction} stretch.direction - the cell's facing, the edge items leave by
     * @param {Point} stretch.entry - the edge midpoint items arrive at
     * @param {Point} stretch.exit - the edge midpoint items leave by
     * @param {Point|null} stretch.center - the arc's center; null for a straight run
     * @param {number} stretch.startAngle - radians from `center` to `entry`; 0 for a straight run
     * @param {number} stretch.sweep - radians the arc turns, signed; 0 for a straight run
     * @param {number} stretch.length - the distance along this stretch, in world pixels
     */
    constructor({
        tileX,
        tileY,
        direction,
        entry,
        exit,
        center,
        startAngle,
        sweep,
        length,
    }) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.direction = direction;
        this.entry = entry;
        this.exit = exit;
        this.center = center;
        this.startAngle = startAngle;
        this.sweep = sweep;
        this.length = length;
    }

    /**
     * The point a distance into this stretch.
     * @param {number} distance - world pixels from the entry edge
     * @returns {Point}
     */
    getPointByDistance(distance) {
        const t = distance / this.length;
        if (this.center === null) {
            return {
                x: this.entry.x + t * (this.exit.x - this.entry.x),
                y: this.entry.y + t * (this.exit.y - this.entry.y),
            };
        }
        const angle = this.startAngle + t * this.sweep;
        return {
            x: this.center.x + TURN_RADIUS * Math.cos(angle),
            y: this.center.y + TURN_RADIUS * Math.sin(angle),
        };
    }
}

/**
 * The line a lane's items ride, one stretch per cell: straight through a cell items pass through,
 * a quarter arc through one they turn in. Positions come off it by distance from the lane's input
 * edge, so an item resting mid-bend stands on the curve rather than on the tile center.
 */
export class LanePath {

    /**
     * @param {LanePathEntry[]} entries - one per cell, head first
     */
    constructor(entries) {
        this._entries = entries;
        /**
         * Distance at each stretch's start, with the lane's total length last.
         * @type {number[]}
         * @private
         */
        this._starts = [0];
        let total = 0;
        for (const entry of entries) {
            total += entry.length;
            this._starts.push(total);
        }
    }

    /**
     * @returns {number} the lane's total length, in world pixels
     */
    get length() {
        return this._starts[this._starts.length - 1];
    }

    /**
     * The distance at which a cell's stretch starts; the index past the last cell gives the
     * lane's total length.
     * @param {number} index - cell index, head first
     * @returns {number}
     */
    getDistanceByCellIndex(index) {
        return this._starts[index];
    }

    /**
     * @param {number} index - cell index, head first
     * @returns {number}
     */
    getLengthByCellIndex(index) {
        return this._entries[index].length;
    }

    /**
     * @param {number} index - cell index, head first
     * @returns {LanePathEntry}
     */
    getEntryByCellIndex(index) {
        return this._entries[index];
    }

    /**
     * The cell a distance falls in; a distance on a boundary belongs to the cell it enters.
     * @param {number} distance - world pixels from the lane's input edge
     * @returns {number}
     */
    getCellIndexByDistance(distance) {
        let low = 0;
        let high = this._entries.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (this._starts[mid] <= distance) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return low;
    }

    /**
     * The point a distance along the lane, clamped to its ends.
     * @param {number} distance - world pixels from the lane's input edge
     * @returns {Point}
     */
    getPointByDistance(distance) {
        if (distance <= 0) {
            return this._entries[0].getPointByDistance(0);
        }
        const last = this._entries.length - 1;
        if (distance >= this.length) {
            return this._entries[last].getPointByDistance(this._entries[last].length);
        }
        const index = this.getCellIndexByDistance(distance);
        return this._entries[index].getPointByDistance(distance - this._starts[index]);
    }
}

/**
 * The center of a tile, in world pixels.
 * @param {number} tileX
 * @param {number} tileY
 * @returns {Point}
 */
function getCenterByTile(tileX, tileY) {
    return {
        x: tileX * TILE_SIZE + TILE_SIZE / 2,
        y: tileY * TILE_SIZE + TILE_SIZE / 2,
    };
}

/**
 * The midpoint of a tile's edge on one side.
 * @param {Point} center
 * @param {Direction} side
 * @returns {Point}
 */
function getEdgeMidpointBySide(center, side) {
    return {
        x: center.x + Direction.dx(side) * TURN_RADIUS,
        y: center.y + Direction.dy(side) * TURN_RADIUS,
    };
}

/**
 * One cell's stretch: items enter over the edge behind their travel and leave by the cell's facing.
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} incoming - the way items travel as they enter the cell
 * @param {Direction} direction - the cell's facing, the way items leave it
 * @returns {LanePathEntry}
 */
export function buildLanePathEntry(tileX, tileY, incoming, direction) {
    const center = getCenterByTile(tileX, tileY);
    const entry = getEdgeMidpointBySide(center, Direction.invert(incoming));
    const exit = getEdgeMidpointBySide(center, direction);
    if (incoming === direction) {
        return new LanePathEntry({
            tileX,
            tileY,
            direction,
            entry,
            exit,
            center: null,
            startAngle: 0,
            sweep: 0,
            length: TILE_SIZE,
        });
    }
    if (incoming === Direction.invert(direction)) {
        throw new Error(`Lane cell at ${tileX},${tileY} is entered head-on`);
    }
    // The turn pivots on the corner both edge midpoints sit a half-tile from.
    const arcCenter = {
        x: entry.x + Direction.dx(direction) * TURN_RADIUS,
        y: entry.y + Direction.dy(direction) * TURN_RADIUS,
    };
    const startAngle = Math.atan2(entry.y - arcCenter.y, entry.x - arcCenter.x);
    const endAngle = Math.atan2(exit.y - arcCenter.y, exit.x - arcCenter.x);
    let sweep = endAngle - startAngle;
    if (sweep > Math.PI) {
        sweep -= 2 * Math.PI;
    }
    if (sweep < -Math.PI) {
        sweep += 2 * Math.PI;
    }
    return new LanePathEntry({
        tileX,
        tileY,
        direction,
        entry,
        exit,
        center: arcCenter,
        startAngle,
        sweep,
        length: TURN_RADIUS * QUARTER_TURN,
    });
}

/**
 * The path a lane's cells trace.
 * @param {CacheEntry[]} cells - head first
 * @param {Direction[]} incomings - the way items travel entering each cell
 * @returns {LanePath}
 */
export function buildLanePath(cells, incomings) {
    const entries = [];
    for (let i = 0; i < cells.length; i += 1) {
        entries.push(buildLanePathEntry(
            cells[i].tileX,
            cells[i].tileY,
            incomings[i],
            cells[i].data.direction,
        ));
    }
    return new LanePath(entries);
}
