import {AbstractBehavior} from "@/sim/behaviors/AbstractBehavior.js";

// Position layer for resource cover: an extraction tile stores its resource type as the cell userData.
export const LAYER_RESOURCE = "R";

/**
 * A resource body: no components beyond PlacedObject and no tick — it occupies its extraction tiles
 * on the resource layer, storing its resource type as the cell value (read by extractors at spawn),
 * and renders as a sprite. The owner-keyed cells are freed generically on delete (untrack).
 */
export class ResourceBehavior extends AbstractBehavior {

    /**
     * @param {object} config
     * @param {number} config.resourceType
     */
    constructor({resourceType}) {
        super();
        this.resourceType = resourceType;
    }

    install(engine, placed) {
        engine.space.registerLayer(LAYER_RESOURCE);
    }

    onSpawn(engine, placed, eid, type, message) {
        const objectId = placed.objectIdOf(eid);
        const cells = type.extractionTiles.map(offset => ({
            x: message.x + offset.x,
            y: message.y + offset.y,
            layer: LAYER_RESOURCE,
        }));
        engine.space.occupy(cells, objectId, this.resourceType);
    }
}
