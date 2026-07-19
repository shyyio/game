/**
 * A cardinal direction ordinal.
 * @typedef {number} Direction
 */

export const Direction = {
    UP: 0,
    RIGHT: 1,
    DOWN: 2,
    LEFT: 3,

    /**
     * A direction's capitalized name (Up, Right, Down, Left).
     * @param {Direction} direction
     * @returns {string}
     */
    name(direction) {
        return ["Up", "Right", "Down", "Left"][direction];
    },

    rotate(direction, rotation) {
        return (direction + rotation) % 4;
    },

    /**
     * The opposite direction (a 180° turn).
     * @param {Direction} direction
     * @returns {Direction}
     */
    invert(direction) {
        return Direction.rotate(direction, 2);
    },

    /**
     * @param direction {Direction}
     * @returns {number}
     */
    dx(direction) {
        switch (direction) {
            case Direction.LEFT:
                return -1;
            case Direction.RIGHT:
                return 1;
            default:
                return 0;
        }
    },

    /**
     * @param direction {Direction}
     * @returns {number}
     */
    dy(direction) {
        switch (direction) {
            case Direction.UP:
                return -1;
            case Direction.DOWN:
                return 1;
            default:
                return 0;
        }
    },

    /**
     * @param direction {Direction}
     * @returns {number}
     */
    angle(direction) {
        return direction * 90;
    },

    /**
     * The axis a direction runs on: 0 for vertical (UP/DOWN), 1 for horizontal (RIGHT/LEFT).
     * @param {Direction} direction
     * @returns {number}
     */
    axis(direction) {
        return direction % 2;
    },

    /**
     * Returns the Direction for a unit cardinal delta (dx, dy); throws otherwise.
     * @param {number} dx
     * @param {number} dy
     * @returns {Direction}
     */
    fromDelta(dx, dy) {
        if (dx === 0 && dy === -1) {
            return Direction.UP;
        }
        if (dx === 1 && dy === 0) {
            return Direction.RIGHT;
        }
        if (dx === 0 && dy === 1) {
            return Direction.DOWN;
        }
        if (dx === -1 && dy === 0) {
            return Direction.LEFT;
        }

        throw new Error(`Not a unit cardinal delta: (${dx}, ${dy})`);
    }
};

// The 4-neighborhood of a tile, where footprints touch (road attachment, route seeds).
export const NEIGHBOR_DELTAS = [
    {dx: 1, dy: 0},
    {dx: -1, dy: 0},
    {dx: 0, dy: 1},
    {dx: 0, dy: -1},
];

export const CHUNK_SIZE = 64;

// A region is REGION_SIZE x REGION_SIZE chunks, centered on the origin, so chunk
// coordinates run from -REGION_SIZE/2 to REGION_SIZE/2 - 1 on each axis. A chunk's
// id is its ordinal within the region, counted left-to-right, top-to-bottom from
// the top-left chunk (id 0).
export const REGION_SIZE = 128;

// The surface position layer: the default ground layer (belts, splitters, machines). A tile holds
// one object per layer, so objects on different layers coexist; each mod names its own further layers
// (e.g. belt undergrounds per axis). Shared by the engine position index and the client ClientCache.
export const LAYER_SURFACE = "S";

/**
 * Core game-setting keys (mods own keys for their own settings).
 * @enum
 */
export const GameSettingsKey = {
    CHUNK_SIZE: 0,
};
