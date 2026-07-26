import {Container, Graphics, Text} from "pixi.js";
import {AbstractDebugDrawLayer} from "@/client/AbstractDebugDrawLayer.js";
import {TILE_SIZE, GAME_FONT} from "@/client/constants.js";
import {LAYER_SURFACE, NEIGHBOR_DELTAS} from "@/common/constants.js";
import {cellNeighbors, tileId} from "@/common/util.js";
import {RoadBehavior, isWorkerBehavior} from "@/sim/behaviors.js";
import {DEBUG_COLOR} from "@/client/Theme.js";
import {drawLine, drawCircle, drawRect} from "@/client/pixiUtils.js";
import {findCommuteRoute} from "@/client/workerRoute.js";

const ROAD_FILL_ALPHA = 0.35;
const LABEL_TEXT_SIZE = 15;
// Radius of the circle marking an assignment's housing end.
const HOUSING_MARKER_RADIUS = 8;

/**
 * Debug overlay for worker networks, derived from the cached entries the way the sim derives them:
 * each network (roads plus the housings bridging them) tinted its own color, its housings and
 * attached machines outlined, a demand/supply label per network, and a line from each manned
 * machine to its housing. Hidden until debug mode is enabled.
 */
export class WorkerDebugLayer extends AbstractDebugDrawLayer {

    /**
     * @param {WorkerAssignmentCache} assignments
     */
    constructor(assignments) {
        super();
        /**
         * The shared machine-staffing index, for the machine->housing lines.
         * @type {WorkerAssignmentCache}
         * @private
         */
        this._assignments = assignments;
        assignments.onChange(() => this.markStale());
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

    /**
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheChange(entry) {
        const behavior = entry.behavior;
        if (behavior !== null && isWorkerBehavior(behavior)) {
            this.markStale();
        }
    }

    /**
     * Re-derives the components from the cached road entries and repaints everything.
     * @private
     * @returns {void}
     */
    _repaint() {
        this._graphics.clear();
        for (const label of this._labels.removeChildren()) {
            label.destroy();
        }

        // tileId -> road cell, over every cached road entry's cells.
        const roadTiles = new Map();
        for (const entry of this.cache.values()) {
            if (entry.behavior instanceof RoadBehavior) {
                for (const cell of entry.cells) {
                    roadTiles.set(tileId(cell.x, cell.y), {x: cell.x, y: cell.y, entryId: entry.id});
                }
            }
        }

        const seen = new Set();
        const seenHousings = new Set();
        for (const [tile, road] of roadTiles) {
            if (seen.has(tile)) {
                continue;
            }
            seen.add(tile);
            const component = [road];
            const housings = [];
            const roadQueue = [road];
            const housingQueue = [];
            const visit = (x, y) => {
                const neighborTile = tileId(x, y);
                const neighbor = roadTiles.get(neighborTile);
                if (neighbor !== undefined) {
                    if (seen.has(neighborTile)) {
                        return;
                    }
                    seen.add(neighborTile);
                    component.push(neighbor);
                    roadQueue.push(neighbor);
                    return;
                }
                const entry = this.cache.at(x, y, LAYER_SURFACE);
                if (entry === null || seenHousings.has(entry.id)) {
                    return;
                }
                const behavior = entry.behavior;
                if (behavior === null || behavior.workerSupply <= 0) {
                    return;
                }
                seenHousings.add(entry.id);
                housings.push(entry);
                housingQueue.push(entry);
            };
            while (roadQueue.length > 0 || housingQueue.length > 0) {
                if (roadQueue.length > 0) {
                    const current = roadQueue.pop();
                    for (const delta of NEIGHBOR_DELTAS) {
                        visit(current.x + delta.dx, current.y + delta.dy);
                    }
                } else {
                    const housing = housingQueue.pop();
                    for (const {x, y} of cellNeighbors(housing.cells)) {
                        visit(x, y);
                    }
                }
            }
            this._drawComponent(component, housings, roadTiles);
        }

        this._drawAssignments();
    }

    /**
     * One network: tinted road tiles, outlined housings and machines, and a demand/supply label.
     * @private
     * @param {{x: number, y: number, entryId: number}[]} component
     * @param {CacheEntry[]} housings - the network's housings, gathered by the fill
     * @param {Map<number, object>} roadTiles
     * @returns {void}
     */
    _drawComponent(component, housings, roadTiles) {
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

        let supply = 0;
        for (const housing of housings) {
            supply += housing.behavior.workerSupply;
            this._outlineFootprint(housing, color);
        }

        // Machines off the road tiles' neighbors, deduplicated by entry.
        let demand = 0;
        const attached = new Set();
        for (const {x, y} of cellNeighbors(component)) {
            if (roadTiles.has(tileId(x, y))) {
                continue;
            }
            const entry = this.cache.at(x, y, LAYER_SURFACE);
            if (entry === null || attached.has(entry.id)) {
                continue;
            }
            const behavior = entry.behavior;
            if (behavior === null || behavior.workerCost === 0) {
                continue;
            }
            attached.add(entry.id);
            demand += behavior.workerCost;
            this._outlineFootprint(entry, color);
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
        const bounds = entry.tileBounds;
        drawRect(
            this._graphics,
            bounds.minTileX * TILE_SIZE,
            bounds.minTileY * TILE_SIZE,
            (bounds.maxTileX - bounds.minTileX + 1) * TILE_SIZE,
            (bounds.maxTileY - bounds.minTileY + 1) * TILE_SIZE,
            color,
        );
    }

    /**
     * Each manned machine's commute route to its nearest housing (the one the figures walk), with
     * a circle on the housing end; a straight line to the sim-assigned housing when no route
     * exists (e.g. partly uncached).
     * @private
     * @returns {void}
     */
    _drawAssignments() {
        for (const assignment of this._assignments.values()) {
            if (!assignment.manned) {
                continue;
            }
            const machineEntry = this.cache.get(assignment.machineId);
            if (machineEntry === null) {
                continue;
            }
            const color = DEBUG_COLOR(assignment.housingId);
            const route = findCommuteRoute(this.cache, machineEntry);
            if (route !== null) {
                this._graphics.moveTo(route[0].x, route[0].y);
                for (let i = 1; i < route.length; i += 1) {
                    this._graphics.lineTo(route[i].x, route[i].y);
                }
                this._graphics.stroke({color, width: 2});
                drawCircle(this._graphics, route[0].x, route[0].y, HOUSING_MARKER_RADIUS, color);
                continue;
            }
            const housingEntry = this.cache.get(assignment.housingId);
            if (housingEntry === null) {
                continue;
            }
            const machineX = machineEntry.tileX * TILE_SIZE + TILE_SIZE / 2;
            const machineY = machineEntry.tileY * TILE_SIZE + TILE_SIZE / 2;
            const housingX = housingEntry.tileX * TILE_SIZE + TILE_SIZE;
            const housingY = housingEntry.tileY * TILE_SIZE + TILE_SIZE;
            drawLine(this._graphics, machineX, machineY, housingX, housingY, color);
            drawCircle(this._graphics, housingX, housingY, HOUSING_MARKER_RADIUS, color);
        }
    }
}
