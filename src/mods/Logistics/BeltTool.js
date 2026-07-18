import {AbstractTool, Direction, Haptics, LAYER_SURFACE, DeleteObjectMessage} from "@/sdk/client.js";
import {CreateBeltMessage} from "./messages.js";
import {BeltType} from "@/mods/Logistics/constants.js";
import {BeltDefinition} from "./objectTypes.js";
import {Belt} from "./BeltLayer.js";
import {inferBeltParent} from "./geometry.js";

export class BeltTool extends AbstractTool {

    /**
     * @param {Client} client
     * @param {BeltGhostLayer} ghostLayer
     */
    constructor(client, ghostLayer) {
        super(client.session);
        this._client = client;
        this._cache = client.cache;
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

    get textureName() {
        return "belt-straight/0";
    }

    onTap(tileX, tileY) {
        const direction = this._rotation.direction;
        const blocked = this._blocked(tileX, tileY);
        this._place(tileX, tileY, direction);
        if (!blocked) {
            // A placed belt advances the center-lock crosshair one tile along the
            // belt, so quick consecutive taps lay a line. A no-op off center-lock.
            this._client.advanceCenterLock(tileX, tileY, direction);
        }
    }

    onTileEnter(tileX, tileY) {
        this._showGhost(tileX, tileY, this._rotation.direction);
    }

    /**
     * Draws the placement ghost facing `direction`, bent from its inferred parent, marking the tile
     * blocked (red), overwritten (blue), or clear (green target).
     * @private
     */
    _showGhost(tileX, tileY, direction) {
        const occupant = this._cache.at(tileX, tileY, LAYER_SURFACE);
        const blocked = occupant !== null && !this._overwritable(occupant);
        const overwrite = occupant !== null && !blocked;
        const tile = [{x: tileX, y: tileY}];
        this._placementFeedbackLayer.show({
            blocked: blocked ? tile : [],
            overwrite: overwrite ? tile : [],
            clear: blocked || overwrite ? [] : tile,
            showTarget: true,
        });
        const {parentX, parentY} = inferBeltParent(this._cache, tileX, tileY, direction);
        const bend = Belt.getBend(direction, tileX, tileY, parentX, parentY);
        this._ghostLayer.showGhost(tileX, tileY, direction, BeltType.NORMAL, bend, blocked);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
        this._placementFeedbackLayer.clear();
    }

    onDragStart(tileX, tileY) {
        this._firstDragStep = true;
    }

    /**
     * Whether the surface layer holds something the tool can't overwrite (a ramp, a splitter,
     * any non-normal-belt object). A normal belt is overwritable, so it doesn't block.
     * @private
     * @returns {boolean}
     */
    _blocked(tileX, tileY) {
        const occupant = this._cache.at(tileX, tileY, LAYER_SURFACE);
        return occupant !== null && !this._overwritable(occupant);
    }

    /**
     * Whether a surface occupant is a normal belt the tool may delete to re-lay (e.g. to rotate it).
     * @private
     * @returns {boolean}
     */
    _overwritable(occupant) {
        return occupant.data.type === BeltDefinition && occupant.data.beltType === BeltType.NORMAL;
    }

    /**
     * Places a normal belt at the tile facing `direction`, replacing any belt
     * already there.
     * @private
     */
    _place(tileX, tileY, direction) {
        this._prevDragTileX = null;
        this._prevDragTileY = null;
        this._placeBelt(tileX, tileY, direction);
    }

    /**
     * Lays a normal belt facing `direction`, replacing a normal belt there but leaving a ramp
     * or any other surface object untouched.
     * @private
     */
    _placeBelt(tileX, tileY, direction) {
        const occupant = this._cache.at(tileX, tileY, LAYER_SURFACE);
        if (occupant !== null) {
            if (!this._overwritable(occupant)) {
                return;
            }
            this.session.sendMessage(new DeleteObjectMessage(occupant.id));
        }
        this.session.sendMessage(new CreateBeltMessage(tileX, tileY, direction, BeltType.NORMAL));
        Haptics.tap();
    }

    onDragTile(tileX, tileY, direction) {
        const fromTileX = tileX - Direction.dx(direction);
        const fromTileY = tileY - Direction.dy(direction);

        if (this._firstDragStep) {
            // The tile the press started on gets its own belt, facing the drag,
            // so the first drag step lays two belts and every step after lays one.
            this._firstDragStep = false;
            this._placeBelt(fromTileX, fromTileY, direction);
        } else if (direction !== this._rotation.direction && this._prevDragTileX === fromTileX && this._prevDragTileY === fromTileY) {
            // Re-lay the corner tile facing the new direction on a turn.
            this._placeBelt(fromTileX, fromTileY, direction);
        }

        // The drag direction becomes the shared facing, so it carries to the next
        // tap/hover and to other tools.
        this._rotation.direction = direction;
        this._prevDragTileX = tileX;
        this._prevDragTileY = tileY;

        this._placeBelt(tileX, tileY, direction);

        // The hover handler fires alongside the drag with the pre-step direction, so
        // refresh the ghost here to face the actual drag step.
        this._showGhost(tileX, tileY, direction);
    }
}
