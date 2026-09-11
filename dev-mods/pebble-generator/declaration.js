import {AbstractModDeclaration, ItemCategory, ItemType} from "@spup/sdk";
import {ITEM_TYPE_PEBBLE} from "./common/constants.js";
import {PebbleGeneratorType} from "./common/objectTypes.js";
import {GeneratorCountRequestMessage} from "./common/messages.js";
import {GeneratorCountEvent} from "./common/events.js";

/**
 * What this mod adds. Data only: the server, the browser and the mod registry all read this file,
 * and no game code runs here.
 */
export class PebbleGeneratorDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "PebbleGenerator";
    }

    /**
     * @returns {ObjectType[]}
     */
    get objectTypes() {
        return [PebbleGeneratorType];
    }

    /**
     * Everything this mod sends between browser and server, listed on both sides.
     * @returns {Function[]}
     */
    get wireClasses() {
        return [GeneratorCountRequestMessage, GeneratorCountEvent];
    }

    /**
     * @returns {ItemCategory[]}
     */
    get items() {
        return [
            new ItemCategory("Pebbles", {
                [ITEM_TYPE_PEBBLE]: new ItemType("Pebble", "pebble-generator/pebble"),
            }),
        ];
    }
}
