import {Tool, Direction} from "@/sdk/client.js";
import {CreateBeltMessage, DeleteBeltMessage} from "./messages.js";
import {BeltType} from "@/mods/Belt/constants.js";

export class BeltTool extends Tool {

    constructor(session, game, ghostLayer) {
        super(session, game);
        this._ghostLayer = ghostLayer;
        this._lastDirection = Direction.UP;
        this._prevDragTileX = null;
        this._prevDragTileY = null;
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

    rotate() {
        this._lastDirection = Direction.rotate(this._lastDirection, 1);
    }

    /**
     * Places a normal belt at the tile facing `direction`, replacing any belt
     * already there.
     * @private
     */
    _place(tileX, tileY, direction) {
        this._prevDragTileX = null;
        this._prevDragTileY = null;
        const existing = this.game.queryScalar("GetBeltAtTile", {x: tileX, y: tileY});
        if (existing != null) {
            this.session.sendMessage(new DeleteBeltMessage(existing));
        }
        this.session.sendMessage(new CreateBeltMessage({x: tileX, y: tileY, direction, beltType: BeltType.NORMAL}));
    }

    onDragTile(tileX, tileY, direction) {
        const fromTileX = tileX - Direction.dx(direction);
        const fromTileY = tileY - Direction.dy(direction);

        if (direction !== this._lastDirection && this._prevDragTileX === fromTileX && this._prevDragTileY === fromTileY) {
            const prevExisting = this.game.queryScalar("GetBeltAtTile", {x: fromTileX, y: fromTileY});
            if (prevExisting != null) {
                this.session.sendMessage(new DeleteBeltMessage(prevExisting));
            }
            this.session.sendMessage(new CreateBeltMessage({x: fromTileX, y: fromTileY, direction, beltType: BeltType.NORMAL}));
        }

        this._lastDirection = direction;
        this._prevDragTileX = tileX;
        this._prevDragTileY = tileY;

        const existing = this.game.queryScalar("GetBeltAtTile", {x: tileX, y: tileY});
        if (existing != null) {
            this.session.sendMessage(new DeleteBeltMessage(existing));
        }
        this.session.sendMessage(new CreateBeltMessage({x: tileX, y: tileY, direction, beltType: BeltType.NORMAL}));
    }
}
