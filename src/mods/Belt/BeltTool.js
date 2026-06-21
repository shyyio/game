
import {Tool} from "@/client/Tool.js";
import {CreateBeltMessage} from "@/mods/Belt/messages.js";
import {Direction} from "@/common/constants.js";

export class BeltTool extends Tool {

    constructor(session) {
        super(session);
        this._lastDirection = Direction.UP;
    }

    get label() {
        return "Belt";
    }

    onTap(x, y) {
        this.session.sendMessage(new CreateBeltMessage({x, y, direction: this._lastDirection}));
    }

    onDragTile(x, y, direction) {
        this._lastDirection = direction;
        this.session.sendMessage(new CreateBeltMessage({x, y, direction}));
    }
}
