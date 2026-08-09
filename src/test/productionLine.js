// The production-line world shared by the tick benchmark and the bench save writer, so both stamp
// out byte-identical layouts.
//
// Each line is LANES_PER_LINE independent (resource -> Extractor -> belt climb -> Bake) lanes, side
// by side. BakeType (1x1, single-input recipe: Quartz -> Sand -> Glass) can't fan one extractor's
// output out to several Bakes without a Splitter, so lanes stay independent rather than sharing an
// extractor — same extractor/belt/machine counts and transfer volume per line either way.

import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {Direction} from "@/common/constants.js";
import {QuartzDepositResourceType, ExtractorType, BakeType} from "@/mods/BaseGame/common/objectTypes.js";
import {BeltDefinition} from "@/mods/Logistics/common/objectTypes.js";

export const LANES_PER_LINE = 3;
// A lane's vertical extent, relative to its extractor at row 0: the extractor's output lands at
// row -1, three belts climb rows -1..-3 (row -3 is the Bake's feeder tile), the Bake sits at row
// -BAKE_DY, and its own output lands one further row north (see lineSinkPort).
const BAKE_DY = 4;

export const LINE_WIDTH = LANES_PER_LINE;
export const CELL_WIDTH = LINE_WIDTH + 1;
export const ROW_STRIDE = BAKE_DY + 2;
export const LINES_PER_BAND = 64;
export const BASE_X = 8;
export const BASE_Y = 8;

/**
 * Stamps one production line at (ox, oy): LANES_PER_LINE independent lanes, lane i at column
 * ox + i, each climbing straight north from its own resource/extractor to its own Bake.
 * @param {GameEngine} engine
 * @param {number} ox
 * @param {number} oy
 * @returns {void}
 */
export function buildLine(engine, ox, oy) {
    for (let lane = 0; lane < LANES_PER_LINE; lane += 1) {
        const x = ox + lane;
        engine.applyMessage(new CreateObjectMessage(QuartzDepositResourceType.typeId, x, oy, Direction.UP));
        engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, x, oy, Direction.UP));
        for (let dy = 1; dy <= 3; dy += 1) {
            engine.applyMessage(new CreateObjectMessage(BeltDefinition.typeId, x, oy - dy, Direction.UP));
        }
        engine.applyMessage(new CreateObjectMessage(BakeType.typeId, x, oy - BAKE_DY, Direction.UP));
    }
}

/**
 * The origin of the k-th line in the tiled grid.
 * @param {number} k
 * @returns {{x: number, y: number}}
 */
export function lineOrigin(k) {
    const col = k % LINES_PER_BAND;
    const row = Math.floor(k / LINES_PER_BAND);
    return {x: BASE_X + col * CELL_WIDTH, y: BASE_Y + row * ROW_STRIDE};
}

/**
 * Every lane's sink port — where its Bake's Glass lands, one tile north of it.
 * @param {GameEngine} engine
 * @param {number} ox
 * @param {number} oy
 * @returns {number[]} port eids, one per lane
 */
export function lineSinkPort(engine, ox, oy) {
    const ports = [];
    for (let lane = 0; lane < LANES_PER_LINE; lane += 1) {
        ports.push(engine.portAt(ox + lane, oy - BAKE_DY - 1, Direction.UP));
    }
    return ports;
}
