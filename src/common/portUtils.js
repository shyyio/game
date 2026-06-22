
import {rotate} from "@/common/util.js";

const DIRECTION_NAMES = ["Up", "Right", "Down", "Left"];

/**
 * Resolves the upstream connections feeding an object placed at vec: for each of
 * objectType's input ports, finds the adjacent object's matching output port,
 * creating a new Port when none exists and createMissing is set.
 * @param {Game} game
 * @param {string} objectType
 * @param {Vec} vec
 * @param {boolean} [createMissing]
 * @returns {Object.<string, BigInt>} map of this object's input port name -> shared Port id
 */
export function upstreamPorts(game, objectType, vec, createMissing=false) {
    const ports = {};

    game.modRegistry.definitions[objectType].inputPorts.forEach(def => {
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
 * Resolves the downstream connections an object placed at vec feeds into: for
 * each of objectType's output ports, finds the adjacent object's matching input
 * port, creating a new Port when none exists and createMissing is set.
 * @param {Game} game
 * @param {string} objectType
 * @param {Vec} vec
 * @param {boolean} [createMissing]
 * @returns {Object.<string, BigInt>} map of this object's output port name -> shared Port id
 */
export function downstreamPorts(game, objectType, vec, createMissing=false) {
    const ports = {};

    game.modRegistry.definitions[objectType].outputPorts.forEach(def => {
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
export function createInternalPorts(game, objectType) {
    const ports = {};

    game.modRegistry.definitions[objectType].internalPorts.forEach(def => {
        ports[def.name] = game.queryScalar("InsertPort");
    });

    return ports;
}

/**
 * Returns all tiles occupied by an object of the given type placed at (x, y, direction).
 * @param {ModRegistry} modRegistry
 * @param {string} objectType
 * @param {number} x
 * @param {number} y
 * @param {Direction} direction
 * @returns {{x: number, y: number}[]}
 */
export function objectTiles(modRegistry, objectType, x, y, direction) {
    const def = modRegistry.definitions[objectType];
    const {x: w, y: h} = rotate(def.size, direction);

    const tiles = [];
    for (let dx = 0; dx <= Math.abs(w); dx++) {
        for (let dy = 0; dy <= Math.abs(h); dy++) {
            tiles.push({x: x + Math.sign(w) * dx, y: y + Math.sign(h) * dy});
        }
    }
    return tiles;
}
