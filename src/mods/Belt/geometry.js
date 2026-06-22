import {
    BELT_RAMP_DOWN,
    BELT_RAMP_UP,
    MAX_UNDERGROUND_LENGTH,
} from "./constants.js";

// ---- Underground belt helpers ----

/**
 * @param rampParent {{x: number, y: number, type: number, direction: Direction}}
 * @param options {{x: number, y: number, type: number, direction: Direction}}
 * @returns {{x: number, y: number}[]}
 */
export function getUndergroundBeltsToCreate(rampParent, options) {
    if (rampParent === null || rampParent.direction !== options.direction
        || (rampParent.type !== BELT_RAMP_DOWN && rampParent.type !== BELT_RAMP_UP)
        || (rampParent.x !== options.x && rampParent.y !== options.y)) {
        throw new Error("Invalid ramp parent for underground belt creation");
    }

    const x1 = rampParent.type === BELT_RAMP_UP ? options.x : rampParent.x;
    const y1 = rampParent.type === BELT_RAMP_UP ? options.y : rampParent.y;
    let x2 = rampParent.type === BELT_RAMP_UP ? rampParent.x : options.x;
    let y2 = rampParent.type === BELT_RAMP_UP ? rampParent.y : options.y;

    const dx = x2 === x1 ? 0 : x2 < x1 ? -1 : 1;
    const dy = y2 === y1 ? 0 : y2 < y1 ? -1 : 1;

    x2 -= dx;
    y2 -= dy;

    let x = x1;
    let y = y1;

    const undergrounds = [];
    while (x !== x2 || y !== y2) {
        x += dx;
        y += dy;
        undergrounds.push({x, y});
    }

    if (undergrounds.length > MAX_UNDERGROUND_LENGTH) {
        return [];
    }

    return undergrounds;
}
