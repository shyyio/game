// Numeric constants and enums for the Belt mod. These are shared across the
// mod's SQL (schema, statements, tick ops), its events, and its imperative
// logic, so they live in one place no other Belt module redefines.

// Maximum number of tiles an underground belt may span.
export const MAX_UNDERGROUND_LENGTH = 4;

/**
 * Game-setting keys this mod owns
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

/**
 * @enum {number}
 */
export const BeltType = {
    NORMAL: BELT_NORMAL,
    RAMP_DOWN: BELT_RAMP_DOWN,
    RAMP_UP: BELT_RAMP_UP,
    UNDERGROUND: BELT_UNDERGROUND,
};

/**
 * @enum {number}
 */
export const BeltBend = {
    STRAIGHT: 0,
    LEFT: 1,
    RIGHT: 2,
};

// ---- Item types ----
export const ITEM_TYPE_GAP = 0;
export const ITEM_FLAG_STASHED = 1;

// ---- Buffered event types ----
// BufferedEvent `type` discriminators for the Belt tick's item deltas. UPSERT
// inserts-or-resizes a path's RLE row (id=path, a=row id, b=length, c=type);
// DELETE drops one (a=row id). The client keeps each path's rows and derives item
// positions from them. (Engine port-item types take 3-4.)
export const BUFFERED_EVENT_TYPE_ITEM_UPSERT = 1;
export const BUFFERED_EVENT_TYPE_ITEM_DELETE = 2;

// A path's items were re-rowed (a belt edit, or a fresh viewer). RESET (id=path)
// clears the client's old rows, then the path's rows are re-emitted as UPSERTs in the
// same drain — an atomic swap, no flicker, and each re-created sprite glides on.
export const BUFFERED_EVENT_TYPE_ITEM_RESET = 5;
