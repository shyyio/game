import {AbstractTool, Direction, Haptics, LAYER_SURFACE, CreateObjectMessage, DeleteObjectMessage} from "@spup/sdk/client";
import {BELT_NORMAL} from "../common/constants.js";
import {BeltDefinition} from "../common/objectTypes.js";
import {Belt} from "./BeltDrawLayer.js";
import {inferBeltParent} from "../common/geometry.js";

export class BeltTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {BeltGhostLayer} ghostLayer
     */
    constructor(client, ghostLayer) {
        super(client.session);
        this._client = client;
        this._cache = client.objects;
        this._ghostLayer = ghostLayer;
        this._placementFeedbackLayer = client.placementFeedbackLayer;
        this._rotation = client.toolRotation;
        this._prevDragTileX = null;
        this._prevDragTileY = null;
        this._firstDragStep = false;
    }

    get label() {
        return "Belt";
    }

    get id() {
        return 2;
    }

    get textureName() {
        return "belt-straight/0";
    }

    onTap(tileX, tileY) {
        const direction = this._rotation.direction;
        const blocked = this._blocked(tileX, tileY, direction);
        this._place(tileX, tileY, direction);
        if (!blocked) {
            // Advance the center-lock crosshair one tile so consecutive taps lay a line.
            this._client.advanceCenterLock(tileX, tileY, direction);
        }
    }

    onTileEnter(tileX, tileY) {
        this._showGhost(tileX, tileY, this._rotation.direction);
    }

    /**
     * Draws the placement ghost, bent from its inferred parent, with per-tile feedback.
     * @private
     */
    _showGhost(tileX, tileY, direction) {
        const occupant = this._cache.at(tileX, tileY, LAYER_SURFACE);
        const blocked = this._blocked(tileX, tileY, direction);
        const overwrite = occupant !== null && !blocked;
        const tile = [{x: tileX, y: tileY}];
        let blockedTiles = [];
        if (blocked) {
            blockedTiles = tile;
        }
        let overwriteTiles = [];
        if (overwrite) {
            overwriteTiles = tile;
        }
        let clearTiles = tile;
        if (blocked || overwrite) {
            clearTiles = [];
        }
        this._placementFeedbackLayer.show({
            blocked: blockedTiles,
            overwrite: overwriteTiles,
            clear: clearTiles,
            showTarget: true,
        });
        const {parentX, parentY} = inferBeltParent(this._cache, tileX, tileY, direction);
        const bend = Belt.getBend(direction, tileX, tileY, parentX, parentY);
        this._ghostLayer.showGhost(tileX, tileY, direction, BELT_NORMAL, bend, blocked);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
        this._placementFeedbackLayer.clear();
    }

    onDragStart(tileX, tileY) {
        this._firstDragStep = true;
    }

    /**
     * Whether the tile sits outside buildable chunks, a mod vetoes the placement, or an occupant
     * can't be overwritten.
     * @private
     * @returns {boolean}
     */
    _blocked(tileX, tileY, direction) {
        if (!this._client.canBuildAt(tileX, tileY)) {
            return true;
        }
        if (!this._client.modsAllowPlacement(BeltDefinition, tileX, tileY, direction)) {
            return true;
        }
        const occupant = this._cache.at(tileX, tileY, LAYER_SURFACE);
        return occupant !== null && !this._overwritable(occupant);
    }

    /**
     * Whether the occupant is a conveyor lane the tool may delete to re-lay.
     * @private
     * @returns {boolean}
     */
    _overwritable(occupant) {
        return occupant.data.type.placement.conveyor;
    }

    /**
     * Places a normal belt at the tile, replacing any belt already there.
     * @private
     */
    _place(tileX, tileY, direction) {
        this._prevDragTileX = null;
        this._prevDragTileY = null;
        this._placeBelt(tileX, tileY, direction);
    }

    /**
     * Lays a normal belt, replacing an overwritable belt but leaving other objects untouched.
     * @private
     */
    _placeBelt(tileX, tileY, direction) {
        // The server would drop an ungated or mod-vetoed placement anyway.
        if (!this._client.canBuildAt(tileX, tileY)
            || !this._client.modsAllowPlacement(BeltDefinition, tileX, tileY, direction)) {
            return;
        }
        const occupant = this._cache.at(tileX, tileY, LAYER_SURFACE);
        if (occupant !== null) {
            if (!this._overwritable(occupant)) {
                return;
            }
            this.session.sendMessage(new DeleteObjectMessage(occupant.id));
        }
        this.session.sendMessage(new CreateObjectMessage(BeltDefinition.typeId, tileX, tileY, direction));
        Haptics.tap();
    }

    onDragTile(tileX, tileY, direction) {
        const fromTileX = tileX - Direction.dx(direction);
        const fromTileY = tileY - Direction.dy(direction);

        if (this._firstDragStep) {
            // First drag step lays two belts: the press tile also gets one, facing the drag.
            this._firstDragStep = false;
            this._placeBelt(fromTileX, fromTileY, direction);
        } else if (direction !== this._rotation.direction && this._prevDragTileX === fromTileX && this._prevDragTileY === fromTileY) {
            // Re-lay the corner tile facing the new direction on a turn.
            this._placeBelt(fromTileX, fromTileY, direction);
        }

        // The drag direction becomes the shared facing.
        this._rotation.direction = direction;
        this._prevDragTileX = tileX;
        this._prevDragTileY = tileY;

        this._placeBelt(tileX, tileY, direction);

        // Refresh the ghost to face the actual drag step.
        this._showGhost(tileX, tileY, direction);
    }
}
