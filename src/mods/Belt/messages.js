
import {Message} from "@/common/Message.js";

const MESSAGE_CREATE_BELT = 1;
const MESSAGE_DELETE_BELT = 2;

export class CreateBeltMessage extends Message {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
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
     * @param {BigInt} [rampParent]
     * @param {BigInt} [disconnectRampChild]
     */
    constructor({x, y, direction, beltType, rampParent, disconnectRampChild}) {
        super();
        this.type = MESSAGE_CREATE_BELT;
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.beltType = beltType;
        this.rampParent = rampParent;
        this.disconnectRampChild = disconnectRampChild;
    }
}

export class DeleteBeltMessage extends Message {

    static wireFields = {
        type: "int32",
        id: "int64",
    };

    /**
     * @param {BigInt} id
     */
    constructor(id) {
        super();
        this.type = MESSAGE_DELETE_BELT;
        this.id = id;
    }
}
