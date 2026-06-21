
import {Tool} from "@/client/Tool.js";
import {CreateBeltMessage, DeleteBeltMessage} from "@/mods/Belt/messages.js";
import {BeltType} from "@/mods/Belt/mod.js";
import {Direction} from "@/common/constants.js";

export class BeltTool extends Tool {

    constructor(session, game) {
        super(session, game);
        this._lastDirection = Direction.UP;
    }

    get label() {
        return "Belt";
    }

    onTap(x, y) {
        const existing = this.game.queryScalar("GetBeltAtTile", {x, y});
        if (existing != null) {
            this.session.sendMessage(new DeleteBeltMessage(existing));
        }
        this.session.sendMessage(new CreateBeltMessage({x, y, direction: this._lastDirection, beltType: BeltType.NORMAL}));
    }

    onDragTile(x, y, direction) {
        this._lastDirection = direction;
        const existing = this.game.queryScalar("GetBeltAtTile", {x, y});
        if (existing != null) {
            this.session.sendMessage(new DeleteBeltMessage(existing));
        }
        this.session.sendMessage(new CreateBeltMessage({x, y, direction, beltType: BeltType.NORMAL}));
    }
}
