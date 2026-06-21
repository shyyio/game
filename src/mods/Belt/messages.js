
export class CreateBeltMessage {

    /**
     * @param {number} x
     * @param {number} y
     * @param {Direction} direction
     * @param {number} [type]
     * @param {BigInt} [rampParent]
     * @param {BigInt} [disconnectRampChild]
     */
    constructor({x, y, direction, type=0, rampParent, disconnectRampChild}) {
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.beltType = type;
        this.rampParent = rampParent;
        this.disconnectRampChild = disconnectRampChild;
    }
}

export class DeleteBeltMessage {

    /**
     * @param {BigInt} id
     */
    constructor(id) {
        this.id = id;
    }
}
