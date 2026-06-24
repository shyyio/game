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

    /**
     * Toggles map mode for this layer. In map mode the layer should render its
     * objects as simple geometry instead of sprites. Optional hook — layers with
     * no geometry representation ignore it.
     * @param {boolean} value
     */
    set lowRes(value) {}

    /**
     * Advances this layer's animated sprites to the globally-synchronized frame.
     * Called only when the frame actually changes. Optional hook — layers with no
     * animation ignore it.
     * @param {number} frame current animation frame, in [0, 8)
     * @returns {void}
     */
    tick(frame) {}
}
