import {AbstractTool} from "@/client/AbstractTool.js";
import {Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
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
     */
    constructor(client, definition, ghostLayer, replaceSameKind, advanceOnPlace=true) {
        super(client.session);
        this._client = client;
        this._cache = client.cache;
        this._definition = definition;
        this._ghostLayer = ghostLayer;
        this._replaceSameKind = replaceSameKind;
        this._advanceOnPlace = advanceOnPlace;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        this._rotation = client.toolRotation;
    }

    get label() {
        return this._definition.label;
    }

    get textureName() {
        return this._definition.textureName;
    }

    onTap(tileX, tileY) {
        const direction = this._rotation.direction;
        const {blockedCells, overwriteIds} = this._evaluate(tileX, tileY, direction);
        if (blockedCells.length > 0) {
            return;
        }
        overwriteIds.forEach(id => this.session.sendMessage(new DeleteObjectMessage(id)));
        this.session.sendMessage(new CreateObjectMessage(this._definition.typeId, tileX, tileY, direction));
        Haptics.tap();
        if (this._advanceOnPlace) {
            // Advances the center-lock crosshair one tile so consecutive taps lay a line; no-op otherwise.
            this._client.advanceCenterLock(tileX, tileY, direction);
        }
        this._showGhost(tileX, tileY, direction);
    }

    onTileEnter(tileX, tileY) {
        this._showGhost(tileX, tileY, this._rotation.direction);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
        this._placementFeedbackLayer.clear();
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
        const blockedCells = [];
        const overwriteCells = [];
        const clearCells = [];
        const overwriteIds = [];
        const base = chunkId(tileX, tileY);
        this._geometryTiles(tileX, tileY, direction).forEach(cell => {
            if (chunkId(cell.x, cell.y) !== base) {
                blockedCells.push(cell);
                return;
            }
            const occupant = this._cache.at(cell.x, cell.y, this._definition.occupancyLayer);
            if (occupant === null) {
                clearCells.push(cell);
            } else if (this._overwritable(occupant, direction)) {
                overwriteCells.push(cell);
                overwriteIds.push(occupant.id);
            } else {
                blockedCells.push(cell);
            }
        });
        return {blockedCells, overwriteCells, clearCells, overwriteIds};
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
        const {blockedCells, overwriteCells, clearCells} = this._evaluate(tileX, tileY, direction);
        this._placementFeedbackLayer.show({blocked: blockedCells, overwrite: overwriteCells, clear: clearCells});
        this._ghostLayer.showGhost(tileX, tileY, direction, blockedCells.length > 0);
    }
}
