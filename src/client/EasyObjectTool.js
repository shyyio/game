import {AbstractTool} from "@/client/AbstractTool.js";
import {Direction} from "@/common/constants.js";
import {chunkId, rotate} from "@/common/util.js";
import {DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import Haptics from "@/client/Haptics.js";

/**
 * Tap-to-place tool: drops one object over its geometry, overwriting an aligned conveyor lane (and
 * optionally its own type), with orientation + center-lock. Belt's drag-to-lay tools are bespoke.
 */
export class EasyObjectTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {ObjectDefinition} definition - the object type placed (its typeId on the message, its
     *     reference for the same-type overwrite check)
     * @param {EasyObjectGhostLayer} ghostLayer
     * @param {boolean} replaceSameKind - whether tapping replaces an existing object of this type
     * @param {boolean} [advanceOnPlace] - whether a placement advances the center-lock crosshair one
     *     tile (so consecutive taps lay a line); off for one-off objects
     * @param {ObjectDefinition[]} [placeOnDefinitions] - object types this object must be placed on an
     *     extraction tile of (e.g. an extractor requiring a resource); their tiles are highlighted blue
     *     and placement off them is blocked
     */
    constructor(client, definition, ghostLayer, replaceSameKind, advanceOnPlace=true, placeOnDefinitions=[]) {
        super(client.session);
        this._client = client;
        this._cache = client.cache;
        this._definition = definition;
        this._ghostLayer = ghostLayer;
        this._replaceSameKind = replaceSameKind;
        this._advanceOnPlace = advanceOnPlace;
        this._placeOn = placeOnDefinitions;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        this._rotation = client.toolRotation;
        this._active = false;
        // Cache-listener unsubscribes, held only while active.
        this._unsubscribes = [];
        // The floating ghost calls back to repaint the placement feedback as it snaps.
        this._ghostLayer.setFollowCursor((baseX, baseY, direction) => this._previewFollow(baseX, baseY, direction));
    }

    get label() {
        return this._definition.label;
    }

    get textureName() {
        return this._definition.textureName;
    }

    onTap(tileX, tileY) {
        const direction = this._rotation.direction;
        // Snap and evaluate synchronously from the live cursor/rotation, so a tap never trusts a
        // ticker-stale preview.
        const base = this._ghostLayer.snapBase(direction);
        if (base === null) {
            return;
        }
        const result = this._evaluate(base.x, base.y, direction);
        if (result.blockedCells.length > 0) {
            return;
        }
        result.overwriteIds.forEach(id => this.session.sendMessage(new DeleteObjectMessage(id)));
        this.session.sendMessage(new CreateObjectMessage(this._definition.typeId, base.x, base.y, direction));
        Haptics.tap();
        // Re-evaluate next frame so the just-placed tile now reads as occupied.
        this._ghostLayer.invalidateSnap();
        if (this._client.centerLock && this._advanceOnPlace) {
            // Advances the center-lock crosshair one tile so consecutive taps lay a line.
            this._client.advanceCenterLock(tileX, tileY, direction);
        }
    }

    /**
     * Repaints the placement feedback (green target where it lands) as the ghost snaps. Returns
     * whether it's blocked, for the ghost tint.
     * @private
     * @returns {boolean}
     */
    _previewFollow(baseX, baseY, direction) {
        const result = this._evaluate(baseX, baseY, direction);
        this._placementFeedbackLayer.show({
            blocked: result.blockedCells,
            overwrite: result.overwriteCells,
            clear: result.clearCells,
            showTarget: true,
        });
        return result.blockedCells.length > 0;
    }

    onActivate() {
        this._active = true;
        if (this._placeOn.length > 0) {
            // Keep the target highlight live as resources come and go, only while active.
            this._unsubscribes.push(this._cache.onStructuralChange(() => this._refreshHighlight()));
            this._unsubscribes.push(this._cache.onRemove(() => this._refreshHighlight()));
        }
        this._refreshHighlight();
    }

    onDeactivate() {
        this._active = false;
        this._unsubscribes.forEach(unsubscribe => unsubscribe());
        this._unsubscribes = [];
        this._placementFeedbackLayer.clearHighlight();
    }

    onTileEnter(tileX, tileY) {
        this._showGhost(tileX, tileY, this._rotation.direction);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
        this._placementFeedbackLayer.clear();
    }

    /**
     * Repaints the blue highlight over every current target tile, while this tool is active.
     * @private
     */
    _refreshHighlight() {
        if (!this._active || this._placeOn.length === 0) {
            return;
        }
        this._placementFeedbackLayer.highlight(this._targetTiles());
    }

    /**
     * The world tiles this object may be placed on: every extraction tile of every cached `placeOn`
     * object (rotated by its facing).
     * @private
     * @returns {{x: number, y: number}[]}
     */
    _targetTiles() {
        const tiles = [];
        this._cache.values().forEach(entry => {
            if (!this._placeOn.includes(entry.data.definition)) {
                return;
            }
            entry.data.definition.extractionTiles.forEach(tile => {
                const cell = rotate({x: tile.x, y: tile.y, direction: Direction.UP}, entry.data.direction);
                tiles.push({x: entry.tileX + cell.x, y: entry.tileY + cell.y});
            });
        });
        return tiles;
    }

    onDragTile(tileX, tileY, direction) {
        // No-op: an easy object is placed one at a time via tap, never by dragging across tiles.
    }

    /**
     * The geometry cells in world coordinates for the object at (tileX, tileY) facing `direction`.
     * @private
     * @returns {{x: number, y: number}[]}
     */
    _geometryTiles(tileX, tileY, direction) {
        return this._definition.geometry.tiles(direction).map(cell => ({x: tileX + cell.x, y: tileY + cell.y}));
    }

    /**
     * Classifies each geometry cell: crossing the base chunk or holding a non-overwritable occupant
     * is blocked; holding an overwritable occupant is overwrite (collected for deletion); otherwise clear.
     * @private
     * @returns {{blockedCells: {x: number, y: number}[], overwriteCells: {x: number, y: number}[], clearCells: {x: number, y: number}[], overwriteIds: BigInt[]}}
     */
    _evaluate(tileX, tileY, direction) {
        const base = chunkId(tileX, tileY);
        // When this object must sit on a target (a resource), a cell off every target is blocked.
        const targetKeys = this._placeOn.length > 0
            ? new Set(this._targetTiles().map(tile => `${tile.x},${tile.y}`))
            : null;

        // Classify each placeable body cell on the object's primary layer (chunk, target, occupant).
        const bodyByKey = new Map();
        const blockedCells = [];
        const overwriteCells = [];
        const clearCells = [];
        const overwriteIds = new Set();
        this._geometryTiles(tileX, tileY, direction).forEach(cell => {
            const key = `${cell.x},${cell.y}`;
            if (chunkId(cell.x, cell.y) !== base || (targetKeys !== null && !targetKeys.has(key))) {
                bodyByKey.set(key, {cell, state: "blocked"});
                return;
            }
            const occupant = this._cache.at(cell.x, cell.y, this._definition.occupancyLayer);
            if (occupant === null) {
                bodyByKey.set(key, {cell, state: "clear"});
            } else if (this._overwritable(occupant, direction)) {
                bodyByKey.set(key, {cell, state: "overwrite", id: occupant.id});
                overwriteIds.add(occupant.id);
            } else {
                bodyByKey.set(key, {cell, state: "blocked"});
            }
        });

        // Mirror the server's per-layer occupancy: block any footprint cell landing on a same-layer
        // occupant (overwritten cells excluded).
        const occupancy = this._occupancyByLayer(overwriteIds);
        this._definition.occupancyLayerTiles(direction).forEach(({layer, cells}) => {
            const occupied = occupancy.get(layer);
            if (occupied === undefined) {
                return;
            }
            cells.forEach(cell => {
                const world = {x: tileX + cell.x, y: tileY + cell.y};
                const key = `${world.x},${world.y}`;
                if (!occupied.has(key)) {
                    return;
                }
                const body = bodyByKey.get(key);
                if (body !== undefined) {
                    body.state = "blocked";
                    body.id = undefined;
                } else if (!blockedCells.some(c => c.x === world.x && c.y === world.y)) {
                    blockedCells.push(world);
                }
            });
        });

        bodyByKey.forEach(entry => {
            if (entry.state === "blocked") {
                blockedCells.push(entry.cell);
            } else if (entry.state === "overwrite") {
                overwriteCells.push(entry.cell);
            } else {
                clearCells.push(entry.cell);
            }
        });
        // Overwrites survive only if no body cell got re-blocked above.
        const finalOverwriteIds = overwriteCells.map(cell => bodyByKey.get(`${cell.x},${cell.y}`).id);
        return {blockedCells, overwriteCells, clearCells, overwriteIds: finalOverwriteIds};
    }

    /**
     * The world tiles occupied per layer by every cached object (its full per-layer footprint), for
     * mirroring the server's IsOccupied. Objects the placement overwrites are excluded.
     * @private
     * @param {Set<BigInt>} excludeIds
     * @returns {Map<number, Set<string>>}
     */
    _occupancyByLayer(excludeIds) {
        const byLayer = new Map();
        this._cache.values().forEach(entry => {
            if (excludeIds.has(entry.id)) {
                return;
            }
            entry.data.definition.occupancyLayerTiles(entry.data.direction).forEach(({layer, cells}) => {
                if (!byLayer.has(layer)) {
                    byLayer.set(layer, new Set());
                }
                const set = byLayer.get(layer);
                cells.forEach(cell => set.add(`${entry.tileX + cell.x},${entry.tileY + cell.y}`));
            });
        });
        return byLayer;
    }

    /**
     * Whether a surface occupant may be deleted to lay this object over it: an aligned conveyor lane
     * (read via the generic `conveyor` cache flag) or, when enabled, another object of this type.
     * @private
     * @returns {boolean}
     */
    _overwritable(occupant, direction) {
        if (this._replaceSameKind && occupant.data.definition === this._definition) {
            return true;
        }
        return occupant.data.conveyor === true
            && Direction.axis(occupant.data.direction) === Direction.axis(direction);
    }

    /**
     * Draws the ghost (tinted red when any cell is blocked) and the per-tile geometry feedback
     * (blocked red, overwrite blue, clear green target).
     * @private
     */
    _showGhost(tileX, tileY, direction) {
        // The ghost floats onto its target (cursor, or screen center in center-lock): just (re)create
        // the sprite; the layer pins it and drives the snapped feedback via _previewFollow each frame.
        this._ghostLayer.showGhost(tileX, tileY, direction, false);
    }
}
