import {AbstractMessage} from "@/sdk/common.js";

export class CreateBeltMessage extends AbstractMessage {

    static wireFields = {
        x: "sint32",
        y: "sint32",
        direction: "int32",
        beltType: "int32?",
        rampParent: "int64?",
        disconnectRampChild: "int64?",
    };

    /**
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number} [beltType]
     * @param {number} [rampParent]
     * @param {number} [disconnectRampChild]
     */
    constructor(x, y, direction, beltType, rampParent, disconnectRampChild) {
        super();
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.beltType = beltType;
        this.rampParent = rampParent;
        this.disconnectRampChild = disconnectRampChild;
    }
}
