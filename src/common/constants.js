/**
 * @enum {number}
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
    },

    /**
     * Returns the nearest cardinal Direction for an arbitrary vector (ties favour vertical), or null for the zero vector.
     * @param {number} dx
     * @param {number} dy
     * @returns {Direction|null}
     */
    fromVector(dx, dy) {
        if (dx === 0 && dy === 0) {
            return null;
        }

        if (Math.abs(dy) >= Math.abs(dx)) {
            return dy < 0 ? Direction.UP : Direction.DOWN;
        }

        return dx < 0 ? Direction.LEFT : Direction.RIGHT;
    }
};

export const CHUNK_SIZE = 64;

/**
 * Core game-setting keys (mods own keys for their own settings).
 * @enum
 */
export const GameSettingsKey = {
    CHUNK_SIZE: 0,
};

// BufferedEvent `type` discriminators owned by the engine. The type space is flat and
// shared with mods: the engine reserves 1-100, mods start at 100 (Belt's are 100+).
// PORT_ITEM_SET sets the item in an output port (id=port, a=item type); PORT_ITEM_CLEAR
// empties one.
export const BUFFERED_EVENT_TYPE_PORT_ITEM_SET = 3;
export const BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR = 4;
