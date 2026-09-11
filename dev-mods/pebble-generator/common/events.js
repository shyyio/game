import {AbstractEvent} from "@spup/sdk";

/**
 * How many pebble generators stand in the world, which only the server knows.
 */
export class GeneratorCountEvent extends AbstractEvent {

    static wireFields = {
        count: "int32",
    };

    /**
     * @param {number} count
     */
    constructor(count) {
        super();
        this.count = count;
    }
}
