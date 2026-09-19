import packageJson from "../../package.json" with {type: "json"};

/**
 * A cardinal direction ordinal.
 * @typedef {number} Direction
 */

/**
 * The axis a direction runs on; the values are what Direction.axis computes.
 * @enum
 */
export const Axis = {
    VERTICAL: 0,
    HORIZONTAL: 1,
};

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

    /**
     * A direction turned by a number of quarter turns clockwise.
     * @param {Direction} direction
     * @param {number} rotation
     * @returns {Direction}
     */
    rotate(direction, rotation) {
        return (direction + rotation) % 4;
    },

    /**
     * A direction stated in an object's own frame, turned into world space by the object's facing.
     * @param {Direction} local
     * @param {Direction} facing
     * @returns {Direction}
     */
    toWorld(local, facing) {
        return Direction.rotate(local, facing);
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
     * @param {Direction} direction
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
     * @param {Direction} direction
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
     * @param {Direction} direction
     * @returns {number}
     */
    angle(direction) {
        return direction * 90;
    },

    /**
     * The axis a direction runs on.
     * @param {Direction} direction
     * @returns {Axis}
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
// (e.g. belt undergrounds per axis). Shared by the engine position index and the client ObjectsView.
export const LAYER_SURFACE = "SURFACE";

// The lane layers off the surface: a buried lane takes a layer per axis, so two cross on one tile.
export const LAYER_LANE_BURIED_HORIZONTAL = "LANE_BURIED_HORIZONTAL";
export const LAYER_LANE_BURIED_VERTICAL = "LANE_BURIED_VERTICAL";
export const LAYER_LANE_ELEVATED_1 = "LANE_ELEVATED_1";
export const LAYER_LANE_ELEVATED_2 = "LANE_ELEVATED_2";

/**
 * Core game-setting keys (mods own keys for their own settings).
 * @enum
 */
export const GameSettingsKey = {
    CHUNK_SIZE: 0,
    // Real-time length of one sim tick, ms.
    TICK_MS: 1,
    // World seed for terrain generation; see WORLD_SEED_MAX.
    SEED: 2,
};

// World seeds are non-negative int32 so they fit a game-setting value.
export const WORLD_SEED_MAX = 0x7fffffff;

// Logic-network keys: flat shared integers like game settings, each device behavior owning its
// own (LOGIC_KEY_OPEN in Logistics, LOGIC_KEY_AMOUNT in Fluids); no registry.
export const LOGIC_KEY_ENABLED = 1;
// Read-only: whether a craft is actually in flight, which a machine's switch alone doesn't say.
export const LOGIC_KEY_PROCESSING = 4;

// Shared default so server/GameBootstrap/Game tick-ms configs can't drift apart.
export const DEFAULT_TICK_MS = 600;

// Toggle setting values; an absent key reads as on, so toggles default on.
export const SETTING_ON = 0;
export const SETTING_OFF = 1;

// The null player: unclaimed chunks, engine-originated messages. Real player refs start at 1.
export const PLAYER_REF_NONE = 0;

// Chunks a player may claim before any bonus grants.
export const DEFAULT_MAX_CHUNKS = 9;

// 3-12 chars, letters/digits/underscore with single spaces between words (no leading/trailing/double).
export const USERNAME_PATTERN = /^(?=.{3,12}$)[A-Za-z0-9_]+(?: [A-Za-z0-9_]+)*$/;
export const USERNAME_PATTERN_HINT = "3-12 chars: letters, digits, _; single spaces, no leading/trailing";

// Sign-in with a differing version is rejected; bump package.json's version on any
// wire- or rule-incompatible change: minor per game release, major reserved for an SDK break.
export const GAME_VERSION = packageJson.version;

// reportingserver's ingest endpoint, on its own subdomain.
// Both the browser client and the game server POST crashes here.
export const REPORTING_URL = "https://bugs.spupgame.com/report";

// A game server's canonical origin per docs/auth.md: scheme, lowercase host, explicit port, no
// trailing slash. Shared by the auth server (validates /join) and the client (normalizes before
// asking for a token), so the two never disagree on what counts as a valid origin.
export const ORIGIN_PATTERN = /^wss?:\/\/[a-z0-9.-]+:(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/;
