export class DrawLayerRegistry {

    /**
     * @param {ModRegistry} modRegistry
     */
    constructor(modRegistry) {
        /**
         * @type {DrawLayer[]}
         */
        this.layers = [];

        modRegistry.drawLayers.forEach(layer => {
            this.add(layer);
        });
    }

    /**
     * Inserts a layer in z-level order.
     * @param {DrawLayer} layer
     */
    add(layer) {
        let i = this.layers.length;
        while (i > 0 && this.layers[i - 1].layerIndex > layer.layerIndex) {
            i -= 1;
        }
        this.layers.splice(i, 0, layer);
    }

    /**
     * @param {BufferedEvent|LiveEvent} event
     */
    publishEvent(event) {
        this.layers.forEach(layer => {
            layer.onEvent(event);
        });
    }
}
