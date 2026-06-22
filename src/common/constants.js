/**
 * @enum
 */
export const Direction = {
    UP: 0,
    RIGHT: 1,
    DOWN: 2,
    LEFT: 3,

    rotate(direction, rotation) {
        return (direction + rotation) % 4;
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
     * Returns the Direction for a unit cardinal delta (dx, dy).
     * Throws if the delta is not a unit cardinal vector.
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

export const CHUNK_SIZE = 64;

/**
 * Core game-setting keys. Mods own the keys for settings they introduce.
 * @enum
 */
export const GameSettingsKey = {
    CHUNK_SIZE: 0,
};
