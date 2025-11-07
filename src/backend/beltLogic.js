import {BeltType, MAX_UNDERGROUND_LENGTH} from "@/backend/constants.js";

/**
 * @param rampParent {{x: Number, y: Number, type: BeltType, direction: Direction, chunk: string}}
 * @param options
 * @returns {Vec[]|null}
 */
export function getUndergroundBeltsToCreate(rampParent, options) {

    /**
     */
    if (rampParent === null || rampParent.direction !== rampParent.direction
        || (rampParent.type !== BeltType.RAMP_DOWN && rampParent.type !== BeltType.RAMP_UP)
        || (rampParent.x !== options.x && rampParent.y !== rampParent.y)) {
        // TODO: error message
        debugger
        return null;
    }

    const x1 = rampParent.type === BeltType.RAMP_UP ? options.x : rampParent.x;
    const y1 = rampParent.type === BeltType.RAMP_UP ? options.y : rampParent.y;
    let x2 = rampParent.type === BeltType.RAMP_UP ? rampParent.x : options.x;
    let y2 = rampParent.type === BeltType.RAMP_UP ? rampParent.y : options.y;

    const dx = x2 === x1 ? 0 : x2 < x1 ? -1 : 1;
    const dy = y2 === y1 ? 0 : y2 < y1 ? -1 : 1;

    x2 -= dx;
    y2 -= dy;

    let x = x1;
    let y = y1;

    let undergrounds = [];
    while (x !== x2 || y !== y2) {
        x += dx;
        y += dy;
        undergrounds.push({x: x, y: y});
    }

    if (undergrounds.length > MAX_UNDERGROUND_LENGTH) {
        return [];
    }

    return undergrounds;
}
