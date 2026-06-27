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
        /**
         * The viewport this layer is drawn in, injected by Client.init.
         * @type {ClientViewport|null}
         */
        this.viewport = null;
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
     * Optional hook: in map mode, render objects as simple geometry instead of sprites.
     * @param {boolean} value
     */
    set lowRes(value) {}

    /**
     * Optional hook: advances animated sprites to the synchronized frame, with the
     * frame's elapsed ms for layers that interpolate continuous motion.
     * @param {number} frame current animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @returns {void}
     */
    tick(frame, deltaMS) {}

    /**
     * Optional hook: pin a placement preview to the screen center in center-lock (mobile) mode.
     * @param {boolean} enabled
     * @returns {void}
     */
    setCenterLock(enabled) {}

    /**
     * Optional hook: show or hide a debug-only overlay; a no-op for non-debug layers.
     * @param {boolean} enabled
     * @returns {void}
     */
    setDebugMode(enabled) {}
}
