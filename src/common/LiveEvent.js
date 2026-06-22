import {chunkKey} from "@/common/util.js";

export class LiveEvent {

    /**
     * @param {number} type
     * @param {number} x
     * @param {number} y
     */
    constructor(type, x, y) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.chunk = chunkKey(x, y);
    }
}
