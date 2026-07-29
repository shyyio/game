import {AbstractTool} from "@/client/AbstractTool.js";
import {Direction} from "@/common/constants.js";
import {chunkId, rotate} from "@/common/util.js";
import {DeleteObjectMessage, CreateObjectMessage} from "@/common/CoreMessages.js";
import Haptics from "@/client/Haptics.js";

/**
 * Tap-to-place tool: drops one object over its geometry, overwriting an aligned conveyor lane (and
 * optionally its own type), with orientation + center-lock. Placement knobs come from the type's
 * PlacementRule; `dragToPlace` adds drag-to-lay, one placement per tile entered. Belt's drag-to-lay
 * tools are bespoke.
 */
export class ObjectTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {ObjectType} type - the object type placed (its typeId on the message, its placement
     *     rule for the overwrite/advance/placeOn knobs)
     * @param {ObjectGhostLayer} ghostLayer
     */
    constructor(client, type, ghostLayer) {
        super(client.session);
        this._client = client;
        this._cache = client.objects;
        this._type = type;
        this._ghostLayer = ghostLayer;
        this._replaceSameKind = type.placement.replaceSameKind;
        this._advanceOnPlace = type.placement.advanceOnPlace;
        this._placeOn = type.placement.placeOn;
        this._dragToPlace = type.placement.dragToPlace;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        // A non-directional type keeps _rotation null: rotate() no-ops, the rotate buttons hide
        // (orientable), and placement always faces UP.
        this._rotation = type.directional ? client.toolRotation : null;
        this._active = false;
        // Cache-listener unsubscribes, held only while active.
        this._unsubscribes = [];
        // The floating ghost calls back to repaint the placement feedback as it snaps.
        this._ghostLayer.setFollowCursor((baseX, baseY, direction) => this._previewFollow(baseX, baseY, direction));
    }

    get label() {
        return this._type.label;
    }

    get textureName() {
        return this._type.textureName;
    }

    onTap(tileX, tileY) {
        const direction = this._placementDirection();
        // Snap and evaluate synchronously from the live cursor/rotation, so a tap never trusts a
        // ticker-stale preview.
        const base = this._ghostLayer.snapBase(direction);
        if (base === null) {
            return;
        }
        if (!this._placeAt(base.x, base.y, direction)) {
            return;
        }
        if (this._client.centerLock && this._advanceOnPlace) {
            // Advances the center-lock crosshair one tile so consecutive taps lay a line.
            this._client.advanceCenterLock(tileX, tileY, direction);
        }
    }

    /**
     * Places the object at the base tile facing `direction`, deleting its overwrites first. Returns
     * whether it placed (false when any cell is blocked).
     * @private
     * @returns {boolean}
     */
    _placeAt(baseX, baseY, direction) {
        const result = this._evaluate(baseX, baseY, direction);
        if (result.blockedCells.length > 0) {
            return false;
        }
        for (const id of result.overwriteIds) {
            this.session.sendMessage(new DeleteObjectMessage(id));
        }
        this.session.sendMessage(new CreateObjectMessage(this._type.typeId, baseX, baseY, direction));
        Haptics.tap();
        // Re-evaluate next frame so the just-placed tile now reads as occupied.
        this._ghostLayer.invalidateSnap();
        return true;
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
        for (const unsubscribe of this._unsubscribes) {
            unsubscribe();
        }
        this._unsubscribes = [];
        this._placementFeedbackLayer.clearHighlight();
    }

    onTileEnter(tileX, tileY) {
        this._showGhost(tileX, tileY, this._placementDirection());
    }

    /**
     * The facing a placement uses: the shared rotation, or UP for a non-directional type.
     * @private
     * @returns {Direction}
     */
    _placementDirection() {
        if (this._rotation !== null) {
            return this._rotation.direction;
        }
        return Direction.UP;
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
        for (const entry of this._cache.values()) {
            if (!this._placeOn.includes(entry.data.type)) {
                continue;
            }
            for (const tile of entry.data.type.extractionTiles) {
                const cell = rotate({x: tile.x, y: tile.y, direction: Direction.UP}, entry.data.direction);
                tiles.push({x: entry.tileX + cell.x, y: entry.tileY + cell.y});
            }
        }
        return tiles;
    }

    onDragStart(tileX, tileY) {
        // The pressed tile gets its placement before the first step, so a dragged run starts under
        // the press.
        this._dragPlace(tileX, tileY);
    }

    onDragTile(tileX, tileY, direction) {
        // The step direction is ignored: placement keeps the tool facing.
        this._dragPlace(tileX, tileY);
    }

    /**
     * Lays one placement at a dragged-over tile, when the type opts into drag-to-lay. A tile already
     * holding this type is left untouched.
     * @private
     */
    _dragPlace(tileX, tileY) {
        if (!this._dragToPlace) {
            return;
        }
        const occupant = this._cache.at(tileX, tileY, this._type.positionLayer);
        if (occupant !== null && occupant.data.type === this._type) {
            return;
        }
        this._placeAt(tileX, tileY, this._placementDirection());
    }

    /**
     * The geometry cells in world coordinates for the object at (tileX, tileY) facing `direction`.
     * @private
     * @returns {{x: number, y: number}[]}
     */
    _geometryTiles(tileX, tileY, direction) {
        return this._type.geometry.tiles(direction).map(cell => ({x: tileX + cell.x, y: tileY + cell.y}));
    }

    /**
     * Classifies each geometry cell: crossing the base chunk or holding a non-overwritable occupant
     * is blocked; holding an overwritable occupant is overwrite (collected for deletion); otherwise clear.
     * @private
     * @returns {{blockedCells: {x: number, y: number}[], overwriteCells: {x: number, y: number}[], clearCells: {x: number, y: number}[], overwriteIds: number[]}}
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
        for (const cell of this._geometryTiles(tileX, tileY, direction)) {
            const key = `${cell.x},${cell.y}`;
            if (chunkId(cell.x, cell.y) !== base || (targetKeys !== null && !targetKeys.has(key))) {
                bodyByKey.set(key, {cell, state: "blocked"});
                continue;
            }
            const occupant = this._solidOccupantAt(cell.x, cell.y);
            if (occupant === null) {
                bodyByKey.set(key, {cell, state: "clear"});
            } else if (this._overwritable(occupant, direction)) {
                bodyByKey.set(key, {cell, state: "overwrite", id: occupant.id});
                overwriteIds.add(occupant.id);
            } else {
                bodyByKey.set(key, {cell, state: "blocked"});
            }
        }

        // Mirror the server's per-layer positions: block any footprint cell landing on a same-layer
        // occupant (overwritten cells excluded).
        const positions = this._positionsByLayer(overwriteIds);
        for (const {layer, cells} of this._type.positionLayerTiles(direction)) {
            const occupied = positions.get(layer);
            if (occupied === undefined) {
                continue;
            }
            for (const cell of cells) {
                const world = {x: tileX + cell.x, y: tileY + cell.y};
                const key = `${world.x},${world.y}`;
                if (!occupied.has(key)) {
                    continue;
                }
                const body = bodyByKey.get(key);
                if (body !== undefined) {
                    body.state = "blocked";
                    body.id = undefined;
                } else if (!blockedCells.some(c => c.x === world.x && c.y === world.y)) {
                    blockedCells.push(world);
                }
            }
        }

        for (const entry of bodyByKey.values()) {
            if (entry.state === "blocked") {
                blockedCells.push(entry.cell);
            } else if (entry.state === "overwrite") {
                overwriteCells.push(entry.cell);
            } else {
                clearCells.push(entry.cell);
            }
        }

        // An unbuildable chunk or a mod veto blocks the whole placement.
        const vetoed = !this._client.canBuildAt(tileX, tileY)
            || this._client.modRegistry.clientMods
                .some(mod => !mod.canPlace(this._type, tileX, tileY, direction, this._client));
        if (vetoed) {
            blockedCells.push(...overwriteCells, ...clearCells);
            return {blockedCells, overwriteCells: [], clearCells: [], overwriteIds: []};
        }

        // Overwrites survive only if no body cell got re-blocked above.
        const finalOverwriteIds = overwriteCells.map(cell => bodyByKey.get(`${cell.x},${cell.y}`).id);
        return {blockedCells, overwriteCells, clearCells, overwriteIds: finalOverwriteIds};
    }

    /**
     * The topmost solid object covering (tileX, tileY) on this type's layer, or null. Mirrors the
     * server: a non-solid object (a water body) occupies nothing.
     * @private
     * @param {number} tileX
     * @param {number} tileY
     * @returns {CacheEntry|null}
     */
    _solidOccupantAt(tileX, tileY) {
        const stacked = this._cache.allAt(tileX, tileY, this._type.positionLayer);
        for (let i = stacked.length - 1; i >= 0; i -= 1) {
            if (stacked[i].data.type.placement.solid) {
                return stacked[i];
            }
        }
        return null;
    }

    /**
     * The world tiles occupied per layer by every cached solid object (its full per-layer
     * footprint), for mirroring the server's IsOccupied. Objects the placement overwrites are
     * excluded.
     * @private
     * @param {Set<number>} excludeIds
     * @returns {Map<number, Set<string>>}
     */
    _positionsByLayer(excludeIds) {
        const byLayer = new Map();
        for (const entry of this._cache.values()) {
            if (excludeIds.has(entry.id) || !entry.data.type.placement.solid) {
                continue;
            }
            for (const {layer, cells} of entry.data.type.positionLayerTiles(entry.data.direction)) {
                if (!byLayer.has(layer)) {
                    byLayer.set(layer, new Set());
                }
                const set = byLayer.get(layer);
                for (const cell of cells) {
                    set.add(`${entry.tileX + cell.x},${entry.tileY + cell.y}`);
                }
            }
        }
        return byLayer;
    }

    /**
     * Whether a surface occupant may be deleted to lay this object over it: an aligned conveyor
     * lane (the type's placement.conveyor) or, when enabled, another object of this type.
     * @private
     * @returns {boolean}
     */
    _overwritable(occupant, direction) {
        if (this._replaceSameKind && occupant.data.type.typeId === this._type.typeId) {
            return true;
        }
        return occupant.data.type.placement.conveyor
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
