// Numeric constants and enums for the Belt mod. These are shared across the
// mod's SQL (schema, statements, tick ops), its events, and its imperative
// logic, so they live in one place no other Belt module redefines.

// Maximum number of tiles an underground belt may span.
export const MAX_UNDERGROUND_LENGTH = 6;

/**
 * Game-setting keys this mod owns (core owns key 0; see GameSettingsKey).
 * @enum
 */
export const BeltGameSettingsKey = {
    MAX_UNDERGROUND_LENGTH: 1,
};

// ---- Belt types ----
export const BELT_NORMAL = 0;
export const BELT_RAMP_DOWN = 1;
export const BELT_RAMP_UP = 2;
export const BELT_UNDERGROUND = 3;

export const BeltType = {
    NORMAL: BELT_NORMAL,
    RAMP_DOWN: BELT_RAMP_DOWN,
    RAMP_UP: BELT_RAMP_UP,
    UNDERGROUND: BELT_UNDERGROUND,
};

export const BeltBend = {
    STRAIGHT: 0,
    LEFT: 1,
    RIGHT: 2,
};

// ---- Item types ----
export const ITEM_TYPE_GAP = 0;
export const ITEM_FLAG_STASHED = 1;

// ---- Event types ----
export const EVENT_BELT_DELETE = 1;
export const EVENT_BELT_INSERT = 2;
export const EVENT_BELT_UPDATE = 3;
export const EVENT_BELT_PATH_RECALCULATE = 4;
