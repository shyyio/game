import {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";

export class DrawLayerRegistry {

    constructor() {
        /**
         * @type {AbstractDrawLayer[]}
         */
        this.layers = [];
        /**
         * Event class -> layers whose eventClasses match it, filled lazily per class.
         * @type {Map<Function, AbstractDrawLayer[]>}
         * @private
         */
        this._subscribers = new Map();
    }

    /**
     * Inserts a layer in z-level order.
     * @param {AbstractDrawLayer} layer
     */
    add(layer) {
        if (layer.onEvent !== AbstractDrawLayer.prototype.onEvent && layer.eventClasses.length === 0) {
            throw new Error(`${layer.constructor.name} overrides onEvent but declares no eventClasses`);
        }
        let i = this.layers.length;
        while (i > 0 && this.layers[i - 1].layerIndex > layer.layerIndex) {
            i -= 1;
        }
        this.layers.splice(i, 0, layer);
        this._subscribers.clear();
    }

    /**
     * Delivers an event to the layers subscribed to its class.
     * @param {AbstractEvent} event
     */
    dispatchEvent(event) {
        for (const layer of this._subscribersFor(event.constructor)) {
            layer.onEvent(event);
        }
    }

    /**
     * The layers subscribed to an event class: those declaring it or a superclass of it.
     * @param {Function} eventClass
     * @returns {AbstractDrawLayer[]}
     * @private
     */
    _subscribersFor(eventClass) {
        let subscribers = this._subscribers.get(eventClass);
        if (subscribers === undefined) {
            subscribers = this.layers.filter(layer => layer.eventClasses.some(
                cls => cls === eventClass || cls.prototype.isPrototypeOf(eventClass.prototype),
            ));
            this._subscribers.set(eventClass, subscribers);
        }
        return subscribers;
    }

    /**
     * Toggles map mode across every layer (simplified geometry instead of sprites).
     * @param {boolean} value
     */
    setMapMode(value) {
        for (const layer of this.layers) {
            layer.mapMode = value;
        }
    }

    /**
     * Advances every layer's animated sprites to the given frame, passing the frame's
     * elapsed milliseconds for continuous (interpolated) motion and the chunks now on screen.
     * @param {number} frame current animation frame, in [0, 8)
     * @param {number} deltaMS elapsed time since the previous tick, in ms
     * @param {Set<number>} visibleChunks the chunks the viewport covers this frame
     */
    tick(frame, deltaMS, visibleChunks) {
        for (const layer of this.layers) {
            layer.tick(frame, deltaMS, visibleChunks);
        }
    }

    /**
     * Toggles center-lock presentation across every layer.
     * @param {boolean} enabled
     */
    setCenterLock(enabled) {
        for (const layer of this.layers) {
            layer.setCenterLock(enabled);
        }
    }

    /**
     * Toggles debug overlays across every layer.
     * @param {boolean} enabled
     */
    setDebugMode(enabled) {
        for (const layer of this.layers) {
            layer.setDebugMode(enabled);
        }
    }
}
