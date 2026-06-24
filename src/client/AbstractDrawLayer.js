import {Container} from "pixi.js";
import {NotImplementedError} from "@/common/error.js";

/**
 * @abstract
 */
export class AbstractDrawLayer extends Container {

    constructor() {
        super();
        /**
         * @type {TextureRegistry|null}
         */
        this.textureRegistry = null;
    }

    /**
     * @abstract
     * @returns {number}
     */
    get layerIndex() {
        throw new NotImplementedError();
    }

    /**
     * @abstract
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        throw new NotImplementedError();
    }
}
