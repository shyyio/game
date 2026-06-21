export class DrawLayerSet {

    /**
     * @param {ModSet} modSet
     */
    constructor(modSet) {
        /**
         * @type {DrawLayer[]}
         */
        this.layers = [];

        modSet.drawLayers.forEach(layer => {
            this.add(layer);
        });
    }

    /**
     * Inserts a layer in z-level order.
     * @param {DrawLayer} layer
     */
    add(layer) {
        let i = this.layers.length;
        while (i > 0 && this.layers[i - 1].zLevel > layer.zLevel) {
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
