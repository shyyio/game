/**
 * @enum
 */
export const Direction = {
    UP: 0,
    RIGHT: 1,
    DOWN: 2,
    LEFT: 3,

    rotate(direction, rotation) {
        return (direction + rotation) % 4
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
    }
};
export const Directions = [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT];

/**
 * @enum
 */
export const BeltBend = {
    STRAIGHT: 0,
    RIGHT: 1,
    LEFT: 2
}

/**
 * @enum
 */
export const BeltType = {
    NORMAL: 0,
    RAMP_DOWN: 1,
    RAMP_UP: 2,
    UNDERGROUND: 3,

    /**
     * @param type {BeltType}
     */
    isUnderground(type) {
        return type !== BeltType.NORMAL;
    }
}


/**
 * @enum
 */
export const EventType = {
    BELT_INSERT: 1,
    BELT_UPDATE: 2,
    BELT_DELETE: 3,
    BELT_PATH_RECALCULATE: 4,
    BELT_PATH_DELETE: 5,
    BELT_PATH_UPDATE: 6,
    BELT_PATH_ITEM_DELETE: 7,
    BELT_PATH_ITEM_UPDATE: 8,
    BELT_PATH_ITEM_INSERT: 9,
    OBJECT_INSERT: 10,
    OBJECT_DELETE: 11,
}

/**
 * @enum
 */
export const ItemType = {
    GAP: 0,
}

/**
 * @enum
 */
export const ItemFlag = {
    STASHED: 1
}


/**
 * @enum {string}
 */
export const GameObject = {
    BELT: "Belt",
    RAMP_DOWN: "RampDown",
    RAMP_UP: "RampUp",
    Splitter: "Splitter",
}


export const ChunkSize = 64;
export const MAX_UNDERGROUND_LENGTH = 6;
