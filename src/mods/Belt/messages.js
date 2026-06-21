
export const MESSAGE_CREATE_BELT = 1;
export const MESSAGE_DELETE_BELT = 2;

export class CreateBeltMessage {

    /**
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number} [beltType]
     * @param {BigInt} [rampParent]
     * @param {BigInt} [disconnectRampChild]
     */
    constructor({x, y, direction, beltType, rampParent, disconnectRampChild}) {
        this.type = MESSAGE_CREATE_BELT;
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.beltType = beltType;
        this.rampParent = rampParent;
        this.disconnectRampChild = disconnectRampChild;
    }
}

export class DeleteBeltMessage {

    /**
     * @param {BigInt} id
     */
    constructor(id) {
        this.type = MESSAGE_DELETE_BELT;
        this.id = id;
    }
}
