import {Direction, LAYER_SURFACE} from "@/common/constants.js";
import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {NO_LANE} from "@/sim/LaneIndex.js";
import {BeltType} from "@/mods/logistics/common/objectTypes.js";

/**
 * One placed belt's lane as a spec reads it: the lane and the ports at its two ends.
 */
export class BeltLane {

    /**
     * @param {GameEngine} engine
     * @param {number} laneRef
     */
    constructor(engine, laneRef) {
        this.laneRef = laneRef;
        this.inPort = engine.lanes.inPortOf(laneRef);
        this.outPort = engine.lanes.outPortOf(laneRef);
    }
}

/**
 * Places one belt through the ordinary placement message.
 * @param {GameEngine} engine
 * @param {number} tileX
 * @param {number} tileY
 * @param {Direction} direction
 * @param {ObjectType} [type]
 * @returns {void}
 */
export function placeBelt(engine, tileX, tileY, direction, type = BeltType) {
    engine.applyMessage(new CreateObjectMessage(type.objectTypeId, tileX, tileY, direction));
}

/**
 * The lane the surface belt at a tile rides, with its end ports; throws when no lane covers it.
 * @param {GameEngine} engine
 * @param {number} tileX
 * @param {number} tileY
 * @param {string} [layer]
 * @returns {BeltLane}
 */
export function beltLaneAt(engine, tileX, tileY, layer = LAYER_SURFACE) {
    const laneRef = engine.lanes.laneAt(tileX, tileY, layer);
    if (laneRef === NO_LANE) {
        throw new Error(`No lane at (${tileX}, ${tileY}) on ${layer}`);
    }
    return new BeltLane(engine, laneRef);
}

/**
 * Every in-flight item on every lane.
 * @param {GameEngine} engine
 * @returns {number}
 */
export function laneItemCount(engine) {
    return engine.lanes.ids().reduce((sum, laneRef) => sum + engine.lanes.itemCountOf(laneRef), 0);
}
