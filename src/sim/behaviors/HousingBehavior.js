import {AbstractBehavior} from "@/common/behaviors/AbstractBehavior.js";

/**
 * A worker source: contributes workerSupply to the road component its footprint touches.
 */
export class HousingBehavior extends AbstractBehavior {

    /**
     * @param {object} config
     * @param {number} config.workerSupply
     */
    constructor({workerSupply}) {
        super();
        this.workerSupply = workerSupply;
    }

    onSpawn(engine, eid, type, message) {
        engine.workers.roads.markDirty(engine.footprint(type, message.x, message.y, message.direction));
    }

    onDespawn(engine, eid) {
        const position = engine.Position;
        engine.workers.roads.markDirty(engine.footprint(this.type, position.x[eid], position.y[eid], position.direction[eid]));
    }
}
