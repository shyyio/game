import {Direction, OCCUPANCY_LAYER_RESOURCE, OCCUPANCY_LAYER_SURFACE} from "@/common/constants.js";
import {rotate} from "@/common/util.js";
import {EasyObjectPlacement} from "@/common/EasyObjectPlacement.js";

/**
 * Sim-side place/remove/sync/schema for a passive, portless resource (a lake, ore patch, volcano) an
 * extractor draws from. Wraps an EasyObjectPlacement; sets the resource occupancy layer, optionally
 * blocks the surface too, and contributes a ResourceCoverAt fragment mapping its extraction tiles to
 * its `resourceType`.
 */
export class EasyResource {

    /**
     * @param {object} config
     * @param {ObjectDefinition} config.definition
     * @param {number} config.resourceType - the id keyed into Recipes as an extractor's input
     * @param {{x: number, y: number}[]} [config.extractionTiles] - relative tiles an extractor
     *     extracts from (direction-rotated); defaults to the body's tiles
     * @param {boolean} [config.blocksSurface] - whether the body also blocks the surface layer
     */
    constructor({definition, resourceType, extractionTiles=null, blocksSurface=false}) {
        this.definition = definition;
        this.resourceType = resourceType;
        // The tiles an extractor draws from (relative, direction-rotated); default the body itself.
        // Stored on the definition so the client can highlight/validate extraction tiles too.
        definition.extractionTiles = extractionTiles === null
            ? definition.geometry.tiles(Direction.UP)
            : extractionTiles;

        definition.occupancyLayer = OCCUPANCY_LAYER_RESOURCE;

        // The resource layer claims the body + extraction tiles (no two resources in one extraction
        // zone); a solid resource also blocks the surface, but only its body — extractors still sit on
        // the ring. Symmetric: the same footprint is used for existing occupants and the new placement.
        definition.occupancyLayerTiles = direction => {
            const body = definition.geometry.tiles(direction);
            const extraction = definition.extractionTiles.map(tile =>
                rotate({x: tile.x, y: tile.y, direction: Direction.UP}, direction));
            // Default extraction is the body itself, so dedupe the two.
            const byKey = new Map();
            [...body, ...extraction].forEach(cell => byKey.set(`${cell.x},${cell.y}`, cell));
            const layers = [{layer: OCCUPANCY_LAYER_RESOURCE, cells: [...byKey.values()]}];
            if (blocksSurface) {
                layers.push({layer: OCCUPANCY_LAYER_SURFACE, cells: body});
            }
            return layers;
        };

        this._placement = new EasyObjectPlacement(definition);
    }

    get schema() {
        return this._placement.schema;
    }

    get statements() {
        return this._placement.statements;
    }

    /**
     * A correlated scalar subquery yielding this resource's `resourceType` when its extraction set
     * covers the tile at (`xExpr`, `yExpr`) SQL expressions, else NULL. Composed by the mod into
     * ResourceCoverAt (with `@x`/`@y`) and the extractor rebind (with an extractor's `x`/`y` columns).
     * @param {string} xExpr
     * @param {string} yExpr
     * @returns {string}
     */
    coverSubquery(xExpr, yExpr) {
        const conditions = [];
        [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT].forEach(direction => {
            this.definition.extractionTiles.forEach(tile => {
                const cell = rotate({x: tile.x, y: tile.y, direction: Direction.UP}, direction);
                conditions.push(`(r.direction = ${direction} AND r.x = ${xExpr} - ${cell.x} AND r.y = ${yExpr} - ${cell.y})`);
            });
        });
        return `(SELECT ${this.resourceType} FROM ${this.definition.table} r WHERE ${conditions.join(" OR ")} LIMIT 1)`;
    }

    handleMessage(game, message) {
        this._placement.handleMessage(game, message);
    }

    chunkSyncEvents(game, chunk) {
        return this._placement.chunkSyncEvents(game, chunk);
    }
}
