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
         * The shared cross-mod object index, bound once by Client via {@link bindCache}, for
         * layers that derive rendering from neighboring objects.
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
     * Binds the shared cache: sets {@link cache} and registers whichever cache hooks the layer
     * overrides. Called once per layer, before init — cache writes can arrive while textures load.
     * @param {ClientCache} cache
     * @returns {void}
     */
    bindCache(cache) {
        this.cache = cache;
        if (this.onCacheSet !== AbstractDrawLayer.prototype.onCacheSet) {
            cache.onSet(entry => this.onCacheSet(entry));
        }
        if (this.onCacheRemove !== AbstractDrawLayer.prototype.onCacheRemove) {
            cache.onRemove(entry => this.onCacheRemove(entry));
        }
        if (this.onCacheChange !== AbstractDrawLayer.prototype.onCacheChange) {
            cache.onSet(entry => this.onCacheChange(entry));
            cache.onRemove(entry => this.onCacheChange(entry));
        }
    }

    /**
     * Optional hook: a cache entry was set; registered only when overridden.
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheSet(entry) {}

    /**
     * Optional hook: a cache entry was removed; registered only when overridden.
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheRemove(entry) {}

    /**
     * Optional hook: a cache entry was set or removed; registered only when overridden.
     * @param {CacheEntry} entry
     * @returns {void}
     */
    onCacheChange(entry) {}

    /**
     * Handles an event whose class matches {@link eventClasses}; never called otherwise, so only
     * layers declaring eventClasses override it.
     * @param {AbstractEvent} event
     * @returns {void}
     */
    onEvent(event) {
        throw new NotImplementedError();
    }

    /**
     * Map-mode presentation: layers hide by default; geometry layers swap to pooled map shapes,
     * screen-feedback layers stay visible.
     * @param {boolean} value
     */
    set mapMode(value) {
        this.visible = !value;
    }

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
