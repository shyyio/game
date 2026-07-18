// The production-line world shared by the tick benchmark and the bench save writer, so both stamp
// out byte-identical layouts.

import {CreateObjectMessage} from "@/common/CoreMessages.js";
import {Direction} from "@/common/constants.js";
import {CreateBeltMessage} from "@/mods/Logistics/messages.js";
import {WaterResourceType, ExtractorType} from "@/mods/Resources/declaration.js";
import {DemoMachineType} from "@/mods/Demo/declaration.js";
import {BELT_NORMAL} from "@/mods/Logistics/constants.js";

// One line spans 9 tiles in x (extractor at 0, belts 1..4, machines/belt 5..8) and one tile in y;
// lines tile on a grid with a spare column/row between them so no two lines ever share a port.
export const LINE_WIDTH = 9;
export const CELL_WIDTH = LINE_WIDTH + 1;
export const ROW_STRIDE = 2;
export const LINES_PER_BAND = 64;
export const BASE_X = 8;
export const BASE_Y = 8;

/**
 * Stamps one production line at (ox, oy) running rightward, exactly as a client would place it.
 * @param {GameEngine} engine
 * @param {number} ox
 * @param {number} oy
 * @returns {void}
 */
export function buildLine(engine, ox, oy) {
    const dir = Direction.RIGHT;
    engine.applyMessage(new CreateObjectMessage(WaterResourceType.typeId, ox, oy, dir));
    engine.applyMessage(new CreateObjectMessage(ExtractorType.typeId, ox, oy, dir));
    for (let i = 1; i <= 4; i += 1) {
        engine.applyMessage(new CreateBeltMessage(ox + i, oy, dir, BELT_NORMAL));
    }
    engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, ox + 5, oy, dir));
    engine.applyMessage(new CreateBeltMessage(ox + 6, oy, dir, BELT_NORMAL));
    engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, ox + 7, oy, dir));
    engine.applyMessage(new CreateObjectMessage(DemoMachineType.typeId, ox + 8, oy, dir));
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
 * The out-port a line's last machine feeds — the edge past the line's right end, where nothing
 * consumes.
 * @param {GameEngine} engine
 * @param {number} ox
 * @param {number} oy
 * @returns {number} the port eid
 */
export function lineSinkPort(engine, ox, oy) {
    return engine.portAt(ox + LINE_WIDTH, oy, Direction.RIGHT);
}
