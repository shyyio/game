import {AbstractBehavior} from "@/common/behaviors/AbstractBehavior.js";

/**
 * A road cell: registers its footprint with the worker network; no ports, no tick.
 */
export class RoadBehavior extends AbstractBehavior {

    onSpawn(engine, placed, eid, type, message) {
        const objectId = placed.objectIdOf(eid);
        for (const cell of engine.footprint(type, message.x, message.y, message.direction)) {
            engine.workers.roads.addRoad(cell.x, cell.y, objectId);
        }
    }

    onDespawn(engine, placed, eid) {
        const position = engine.Position;
        for (const cell of engine.footprint(this.type, position.x[eid], position.y[eid], position.direction[eid])) {
            engine.workers.roads.removeRoad(cell.x, cell.y);
        }
    }
}

/**
 * Whether a behavior participates in worker routing (roads, housing supply, manned machines).
 * @param {AbstractBehavior} behavior
 * @returns {boolean}
 */
export function isWorkerBehavior(behavior) {
    return behavior instanceof RoadBehavior || behavior.workerSupply > 0 || behavior.workerCost > 0;
}
