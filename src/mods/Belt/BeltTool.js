
import {Tool, Direction} from "@/sdk/client.js";
import {CreateBeltMessage, DeleteBeltMessage} from "@/mods/Belt/messages.js";
import {BeltType} from "@/mods/Belt/mod.js";

export class BeltTool extends Tool {

    constructor(session, game) {
        super(session, game);
        this._lastDirection = Direction.UP;
        this._prevDragTileX = null;
        this._prevDragTileY = null;
    }

    get label() {
        return "Belt";
    }

    onTap(tileX, tileY) {
        this._prevDragTileX = null;
        this._prevDragTileY = null;
        const existing = this.game.queryScalar("GetBeltAtTile", {x: tileX, y: tileY});
        if (existing != null) {
            this.session.sendMessage(new DeleteBeltMessage(existing));
        }
        this.session.sendMessage(new CreateBeltMessage({x: tileX, y: tileY, direction: this._lastDirection, beltType: BeltType.NORMAL}));
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
