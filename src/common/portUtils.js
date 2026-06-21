
import {rotate} from "@/util.js";

const DIRECTION_NAMES = ["Up", "Right", "Down", "Left"];

/**
 * For each of objectType's inputPorts, find the matching output port
 * of an adjacent object at vec, or create a new Port if createMissing is set.
 * @param {Game} game
 * @param {string} objectType
 * @param {Vec} vec
 * @param {boolean} [createMissing]
 * @returns {Object.<string, BigInt>}
 */
export function getOutputPorts(game, objectType, vec, createMissing=false) {
    const ports = {};

    game.modSet.definitions[objectType].inputPorts.forEach(def => {
        const rotated = rotate(def, vec.direction);
        const dirName = DIRECTION_NAMES[rotated.direction];
        const port = game.queryScalar(`GetOutPort${dirName}`, {
            x: vec.x + rotated.x,
            y: vec.y + rotated.y,
        });

        if (port) {
            ports[def.name] = port;
        } else if (createMissing) {
            ports[def.name] = game.queryScalar("InsertPort");
        }
    });

    return ports;
}

/**
 * For each of objectType's outputPorts, find the matching input port
 * of an adjacent object at vec, or create a new Port if createMissing is set.
 * @param {Game} game
 * @param {string} objectType
 * @param {Vec} vec
 * @param {boolean} [createMissing]
 * @returns {Object.<string, BigInt>}
 */
export function getInputPorts(game, objectType, vec, createMissing=false) {
    const ports = {};

    game.modSet.definitions[objectType].outputPorts.forEach(def => {
        const rotated = rotate(def, vec.direction);
        const dirName = DIRECTION_NAMES[rotated.direction];
        const port = game.queryScalar(`GetInPort${dirName}`, {
            x: vec.x + rotated.x,
            y: vec.y + rotated.y,
        });

        if (port) {
            ports[def.name] = port;
        } else if (createMissing) {
            ports[def.name] = game.queryScalar("InsertPort");
        }
    });

    return ports;
}

/**
 * Creates a new Port for each internal port definition of objectType.
 * @param {Game} game
 * @param {string} objectType
 * @returns {Object.<string, BigInt>}
 */
export function getInternalPorts(game, objectType) {
    const ports = {};

    game.modSet.definitions[objectType].internalPorts.forEach(def => {
        ports[def.name] = game.queryScalar("InsertPort");
    });

    return ports;
}

/**
 * Returns all tiles occupied by an object of the given type placed at (x, y, direction).
 * @param {ModSet} modSet
 * @param {string} objectType
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @returns {{x: number, y: number}[]}
 */
export function objectTiles(modSet, objectType, x, y, direction) {
    const def = modSet.definitions[objectType];
    const {x: w, y: h} = rotate(def.size, direction);

    const tiles = [];
    for (let dx = 0; dx <= Math.abs(w); dx++) {
        for (let dy = 0; dy <= Math.abs(h); dy++) {
            tiles.push({x: x + Math.sign(w) * dx, y: y + Math.sign(h) * dy});
        }
    }
    return tiles;
}
