import {Container, Graphics, Text} from "pixi.js";
import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
import {TILE_SIZE, GAME_FONT} from "@/client/constants.js";
import {LAYER_SURFACE} from "@/common/constants.js";
import {tileId} from "@/common/util.js";
import {RoadBehavior} from "@/common/sim/behaviors.js";
import {LaborAssignmentEvent, NO_HOUSING} from "@/common/LaborEvents.js";
import {DEBUG_COLOR} from "@/client/Theme.js";
import {drawLine, drawCircle, drawRect} from "@/client/pixiUtils.js";

const ROAD_FILL_ALPHA = 0.35;
const LABEL_TEXT_SIZE = 15;
// Radius of the circle marking an assignment's housing end.
const HOUSING_MARKER_RADIUS = 8;

// 4-neighborhood shared with the sim's road flood fill.
const NEIGHBOR_DELTAS = [
    {dx: 1, dy: 0},
    {dx: -1, dy: 0},
    {dx: 0, dy: 1},
    {dx: 0, dy: -1},
];

/**
 * Debug overlay for labor networks, derived from the cached entries the way the sim derives them:
 * each road component tinted its own color, attached housings/machines outlined in it, a
 * demand/supply label per component, and a line from each manned machine to its housing. Hidden
 * until debug mode is enabled.
 */
export class LaborDebugLayer extends AbstractDrawLayer {

    constructor() {
        super();
        this.visible = false;
        this._debugMode = false;
        // Map mode (zoomed far out) is too coarse for the overlay; it hides regardless of debug mode.
        this._mapMode = false;
        // Repaint lazily on the next tick after a labor-relevant change.
        this._stale = true;
        /**
         * machineId -> housingId for every manned machine in watched chunks.
         * @type {Map<number, number>}
         * @private
         */
        this._assignments = new Map();
        this._graphics = new Graphics();
        this.addChild(this._graphics);
        // Per-component labels, rebuilt on every repaint.
        this._labels = new Container();
        this.addChild(this._labels);
    }

    get layerIndex() {
        // Above the belt path overlay (100).
        return 101;
    }

    get eventClasses() {
        return [LaborAssignmentEvent];
    }

    /**
     * Tracks an assignment change for the machine->housing lines.
     * @param {LaborAssignmentEvent} event
     * @returns {void}
     */
    onEvent(event) {
        if (event.housingId === NO_HOUSING) {
            this._assignments.delete(event.machineId);
        } else {
            this._assignments.set(event.machineId, event.housingId);
        }
        this._stale = true;
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
        const type = entry.data.type;
        if (type === undefined || type.behavior === null) {
            return;
        }
        const behavior = type.behavior;
        if (behavior instanceof RoadBehavior || behavior.laborSupply > 0 || behavior.laborCost > 0) {
            this._stale = true;
        }
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
     * Hides the overlay in map mode, restoring it on zoom-in if debug mode is on.
     * @param {boolean} value
     */
    set mapMode(value) {
        this._mapMode = value;
        this._updateVisibility();
    }

    /**
     * @private
     * @returns {void}
     */
    _updateVisibility() {
        this.visible = this._debugMode && !this._mapMode;
        this._stale = true;
    }

    /**
     * Repaints when shown and stale.
     * @param {number} frame
     * @param {number} deltaMS
     * @returns {void}
     */
    tick(frame, deltaMS) {
        if (this.visible && this._stale) {
            this._stale = false;
            this._redraw();
        }
    }

    /**
     * Re-derives the components from the cached road entries and repaints everything.
     * @private
     * @returns {void}
     */
    _redraw() {
        this._graphics.clear();
        for (const label of this._labels.removeChildren()) {
            label.destroy();
        }

        // tileId -> road cell, over every cached road entry's cells.
        const roadTiles = new Map();
        for (const entry of this.cache.values()) {
            const type = entry.data.type;
            if (type !== undefined && type.behavior instanceof RoadBehavior) {
                for (const cell of entry.cells) {
                    roadTiles.set(tileId(cell.x, cell.y), {x: cell.x, y: cell.y, entryId: entry.id});
                }
            }
        }

        const seen = new Set();
        for (const [tile, road] of roadTiles) {
            if (seen.has(tile)) {
                continue;
            }
            seen.add(tile);
            const component = [road];
            const queue = [road];
            while (queue.length > 0) {
                const current = queue.pop();
                for (const delta of NEIGHBOR_DELTAS) {
                    const neighborTile = tileId(current.x + delta.dx, current.y + delta.dy);
                    if (seen.has(neighborTile) || !roadTiles.has(neighborTile)) {
                        continue;
                    }
                    seen.add(neighborTile);
                    const neighbor = roadTiles.get(neighborTile);
                    component.push(neighbor);
                    queue.push(neighbor);
                }
            }
            this._drawComponent(component, roadTiles);
        }

        this._drawAssignments();
    }

    /**
     * One component: tinted road tiles, outlined attachments, and a demand/supply label.
     * @private
     * @param {{x: number, y: number, entryId: number}[]} component
     * @param {Map<number, object>} roadTiles
     * @returns {void}
     */
    _drawComponent(component, roadTiles) {
        let colorSeed = component[0].entryId;
        for (const road of component) {
            if (road.entryId < colorSeed) {
                colorSeed = road.entryId;
            }
        }
        const color = DEBUG_COLOR(colorSeed);

        for (const road of component) {
            this._graphics
                .rect(road.x * TILE_SIZE, road.y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
                .fill({color, alpha: ROAD_FILL_ALPHA});
        }

        // Attachments off the road tiles' neighbors, deduplicated by entry.
        let supply = 0;
        let demand = 0;
        const attached = new Set();
        for (const road of component) {
            for (const delta of NEIGHBOR_DELTAS) {
                const x = road.x + delta.dx;
                const y = road.y + delta.dy;
                if (roadTiles.has(tileId(x, y))) {
                    continue;
                }
                const entry = this.cache.at(x, y, LAYER_SURFACE);
                if (entry === null || attached.has(entry.id)) {
                    continue;
                }
                const type = entry.data.type;
                if (type === undefined || type.behavior === null) {
                    continue;
                }
                const behavior = type.behavior;
                if (behavior.laborSupply === 0 && behavior.laborCost === 0) {
                    continue;
                }
                attached.add(entry.id);
                supply += behavior.laborSupply;
                demand += behavior.laborCost;
                this._outlineFootprint(entry, color);
            }
        }

        // Demand/supply at the component's seed tile.
        const anchor = component.find(road => road.entryId === colorSeed);
        const label = new Text({
            text: `${demand}/${supply}`,
            style: {
                fontFamily: GAME_FONT,
                fontSize: LABEL_TEXT_SIZE,
                fill: color,
                fontWeight: "bold",
                stroke: {color: 0x000000, width: 2},
            },
        });
        label.x = anchor.x * TILE_SIZE + 2;
        label.y = anchor.y * TILE_SIZE + 2;
        this._labels.addChild(label);
    }

    /**
     * Outlines an attached entry's footprint bounding box.
     * @private
     * @param {CacheEntry} entry
     * @param {number} color
     * @returns {void}
     */
    _outlineFootprint(entry, color) {
        let minX = entry.cells[0].x;
        let minY = entry.cells[0].y;
        let maxX = minX;
        let maxY = minY;
        for (const cell of entry.cells) {
            minX = Math.min(minX, cell.x);
            minY = Math.min(minY, cell.y);
            maxX = Math.max(maxX, cell.x);
            maxY = Math.max(maxY, cell.y);
        }
        drawRect(
            this._graphics,
            minX * TILE_SIZE,
            minY * TILE_SIZE,
            (maxX - minX + 1) * TILE_SIZE,
            (maxY - minY + 1) * TILE_SIZE,
            color,
        );
    }

    /**
     * A line from each manned machine to its housing, with a circle on the housing end.
     * @private
     * @returns {void}
     */
    _drawAssignments() {
        for (const [machineId, housingId] of this._assignments) {
            const machineEntry = this.cache.get(machineId);
            const housingEntry = this.cache.get(housingId);
            if (machineEntry === null || housingEntry === null) {
                continue;
            }
            const color = DEBUG_COLOR(housingId);
            const machineX = machineEntry.tileX * TILE_SIZE + TILE_SIZE / 2;
            const machineY = machineEntry.tileY * TILE_SIZE + TILE_SIZE / 2;
            const housingX = housingEntry.tileX * TILE_SIZE + TILE_SIZE;
            const housingY = housingEntry.tileY * TILE_SIZE + TILE_SIZE;
            drawLine(this._graphics, machineX, machineY, housingX, housingY, color);
            drawCircle(this._graphics, housingX, housingY, HOUSING_MARKER_RADIUS, color);
        }
    }
}
