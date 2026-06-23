export class DrawLayerRegistry {

    /**
     * @param {ModRegistry} modRegistry
     */
    constructor(modRegistry) {
        /**
         * @type {AbstractDrawLayer[]}
         */
        this.layers = [];

        modRegistry.drawLayers.forEach(layer => {
            this.add(layer);
        });
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
    publishEvent(event) {
        this.layers.forEach(layer => {
            layer.onEvent(event);
        });
    }
}
