import {AbstractBehavior} from "@/common/behaviors/AbstractBehavior.js";
import {LANE_LEVEL_SURFACE, getLaneCellLayer} from "@/sim/LaneIndex.js";

/**
 * One cell of a transport lane: a tile items step along, `slotsPerTile` slots long, one slot per
 * tick. The core derives the whole lane from the cells' geometry (`engine.lanes`), so a content mod
 * writes an ObjectType with its input/output ports and nothing else.
 */
export class LaneBehavior extends AbstractBehavior {

    /**
     * @param {object} [config]
     * @param {number} [config.slotsPerTile] - item positions per cell
     * @param {number} [config.inLevel] - LANE_LEVEL_* the cell takes flow from
     * @param {number} [config.outLevel] - LANE_LEVEL_* the cell gives flow to
     */
    constructor({
        slotsPerTile = 2,
        inLevel = LANE_LEVEL_SURFACE,
        outLevel = LANE_LEVEL_SURFACE,
    } = {}) {
        super();
        this.slotsPerTile = slotsPerTile;
        this.inLevel = inLevel;
        this.outLevel = outLevel;
    }

    /**
     * Which of several cells feeding this one continues its lane; the newest wins. Called on a
     * rebuild, never per tick.
     * @param {GameEngine} engine
     * @param {number[]} candidates
     * @returns {number} eid
     */
    chooseParent(engine, candidates) {
        let chosen = candidates[0];
        for (const eid of candidates) {
            if (engine.placed.getObjectRefByEid(eid) > engine.placed.getObjectRefByEid(chosen)) {
                chosen = eid;
            }
        }
        return chosen;
    }

    /**
     * @param {Direction} direction
     * @returns {string[]}
     */
    getPositionLayersByDirection(direction) {
        return [getLaneCellLayer(this.inLevel, this.outLevel, direction)];
    }

    /**
     * @param {GameEngine} engine
     * @param {number} eid
     * @param {ObjectType} type
     * @param {CreateObjectMessage} message
     * @returns {void}
     */
    onSpawn(engine, eid, type, message) {
        engine.lanes.addCell(eid);
    }

    /**
     * @param {GameEngine} engine
     * @param {number} eid
     * @returns {void}
     */
    onDespawn(engine, eid) {
        engine.lanes.removeCell(eid);
    }

    /**
     * The lane owns its tail's output port, so a cell registers none of its own.
     * @param {GameEngine} engine
     * @param {number} eid
     * @returns {void}
     */
    resyncRenderedPorts(engine, eid) {

    }
}
