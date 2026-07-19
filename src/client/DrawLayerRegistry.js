export class DrawLayerRegistry {

    constructor() {
        /**
         * @type {AbstractDrawLayer[]}
         */
        this.layers = [];
    }

    /**
     * Inserts a layer in z-level order.
     * @param {AbstractDrawLayer} layer
     */
    add(layer) {
        let i = this.layers.length;
        while (i > 0 && this.layers[i - 1].layerIndex > layer.layerIndex) {
            i -= 1;
        }
        this.layers.splice(i, 0, layer);
    }

    /**
     * @param {AbstractEvent} event
     */
    dispatchEvent(event) {
        for (const layer of [...this.layers]) {
            layer.onEvent(event);
        }
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
