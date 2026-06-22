import {Container} from "pixi.js";

/**
 * @abstract
 */
export class DrawLayer extends Container {

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
    get zLevel() {
        return 0;
    }

    /**
     * @abstract
     * @param {BufferedEvent|LiveEvent} event
     */
    onEvent(event) {

    }
}
