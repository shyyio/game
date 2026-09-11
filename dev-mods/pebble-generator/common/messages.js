import {AbstractMessage} from "@spup/sdk";

/**
 * Asks how many pebble generators stand in the world, and to be told whenever that changes.
 */
export class GeneratorCountRequestMessage extends AbstractMessage {

    static wireFields = {};
}
