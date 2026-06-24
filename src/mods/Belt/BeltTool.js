import {AbstractTool, Direction} from "@/sdk/client.js";
import {CreateBeltMessage, DeleteBeltMessage} from "./messages.js";
import {BeltType} from "@/mods/Belt/constants.js";

export class BeltTool extends AbstractTool {

    /**
     * @param {AbstractSession} session
     * @param {ViewportCache} beltCache
     * @param {BeltGhostLayer} ghostLayer
     */
    constructor(session, beltCache, ghostLayer) {
        super(session);
        this._beltCache = beltCache;
        this._ghostLayer = ghostLayer;
        this._lastDirection = Direction.UP;
        this._prevDragTileX = null;
        this._prevDragTileY = null;
        this._firstDragStep = false;
    }

    get label() {
        return "Belt";
    }

    onTap(tileX, tileY) {
        this._place(tileX, tileY, this._lastDirection);
    }

    onLongTap(tileX, tileY, direction) {
        this._lastDirection = direction;
        this._place(tileX, tileY, direction);
    }

    onTileEnter(tileX, tileY) {
        this._ghostLayer.showGhost(tileX, tileY, this._lastDirection, BeltType.NORMAL);
    }

    onTileExit(tileX, tileY) {
        this._ghostLayer.clear();
    }

    onDragStart(tileX, tileY) {
        this._firstDragStep = true;
    }

    rotate() {
        this._lastDirection = Direction.rotate(this._lastDirection, 1);
    }

    /**
     * The id of the surface belt at a tile, or null. Mirrors the old GetBeltAtTile
     * query: underground belts are buried and never targeted by the surface tool.
     * @private
     * @returns {BigInt|null}
     */
    _surfaceBeltAt(tileX, tileY) {
        const records = this._beltCache.getAtTile(tileX, tileY);
        const surface = records.find(record => record.data.type !== BeltType.UNDERGROUND);
        return surface === undefined ? null : surface.id;
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
     * Deletes any surface belt at the tile, then lays a normal belt facing
     * `direction`.
     * @private
     */
    _placeBelt(tileX, tileY, direction) {
        const existing = this._surfaceBeltAt(tileX, tileY);
        if (existing != null) {
            this.session.sendMessage(new DeleteBeltMessage(existing));
        }
        this.session.sendMessage(new CreateBeltMessage({x: tileX, y: tileY, direction, beltType: BeltType.NORMAL}));
    }

    onDragTile(tileX, tileY, direction) {
        const fromTileX = tileX - Direction.dx(direction);
        const fromTileY = tileY - Direction.dy(direction);

        if (this._firstDragStep) {
            // The tile the press started on gets its own belt, facing the drag,
            // so the first drag step lays two belts and every step after lays one.
            this._firstDragStep = false;
            this._placeBelt(fromTileX, fromTileY, direction);
        } else if (direction !== this._lastDirection && this._prevDragTileX === fromTileX && this._prevDragTileY === fromTileY) {
            // Re-lay the corner tile facing the new direction on a turn.
            this._placeBelt(fromTileX, fromTileY, direction);
        }

        this._lastDirection = direction;
        this._prevDragTileX = tileX;
        this._prevDragTileY = tileY;

        this._placeBelt(tileX, tileY, direction);
    }
}
