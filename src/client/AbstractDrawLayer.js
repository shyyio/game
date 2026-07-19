import {Container} from "pixi.js";
import {NotImplementedError} from "@/common/error.js";

/**
 * @abstract
 */
export class AbstractDrawLayer extends Container {

    constructor() {
        super();
        // Nothing in the world is picked through pixi: tools work off Mouse tile math, and every
        // interactive control is a HUD Container on the stage. Without this, each pointermove
        // hit-tests every sprite in the layer.
        this.eventMode = "none";
        // Each layer batches and uploads on its own: a change inside one layer (a gliding item,
        // an animation frame) re-packs only that layer's geometry, not the whole scene's.
        this.isRenderGroup = true;
        /**
         * @type {TextureRegistry|null}
         */
        this.textureRegistry = null;
        /**
         * The viewport this layer is drawn in, injected by Client.init.
         * @type {ClientViewport|null}
         */
        this.viewport = null;
        /**
         * The shared cross-mod object index, injected by Client.init, for layers that derive
         * rendering from neighboring objects.
         * @type {ClientCache|null}
         */
        this.cache = null;
    }

    /**
     * @abstract
     * @returns {number}
     */
    get layerIndex() {
        throw new NotImplementedError();
    }

    /**
     * Optional hook: the event classes this layer's onEvent handles (subclasses match too).
     * @returns {Function[]}
     */
    get eventClasses() {
        return [];
    }

    /**
     * Handles an event whose class matches {@link eventClasses}; never called otherwise.
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
    set mapMode(value) {}

    /**
     * Optional hook: advances animated sprites to the synchronized frame, with the frame's elapsed
     * ms for layers that interpolate continuous motion and the chunks now on screen for layers that
     * cull their children.
     * @param {number} frame current animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks the chunks the viewport covers this frame
     * @returns {void}
     */
    tick(frame, deltaMS, visibleChunks) {}

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
