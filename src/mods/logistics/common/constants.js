import {
    Direction,
    KeybindingEntry,
    LANE_LEVEL_SURFACE,
    LANE_LEVEL_BURIED,
    LANE_LEVEL_ELEVATED_1,
} from "@spup/sdk";

// Shared numeric constants and enums for the Logistics mod.

export const KEYBINDING_BELT_RAISE = new KeybindingEntry(11, "Raise belt", "w");
export const KEYBINDING_BELT_LOWER = new KeybindingEntry(12, "Lower belt", "s");

// Maximum tiles an underground belt may span.
export const MAX_UNDERGROUND_LENGTH = 4;

export const BELT_NORMAL = 0;
export const BELT_TUNNEL_DOWN = 1;
export const BELT_TUNNEL_UP = 2;
export const BELT_UNDERGROUND = 3;
// A ramp's number is the elevated level it touches.
export const BELT_RAMP_UP_1 = 4;
export const BELT_ELEVATED_1 = 5;
export const BELT_RAMP_DOWN_1 = 6;

/**
 * One belt kind: the levels it takes flow at and hands it on at, and whether it merges from its
 * flanks. Every level, port and layer decision a belt makes is read off this.
 */
class BeltKindEntry {

    /**
     * @param {BeltType} kind
     * @param {LaneLevel} inLevel
     * @param {LaneLevel} outLevel
     * @param {boolean} isMerging - takes its two flank inputs as well as its straight one
     */
    constructor(kind, inLevel, outLevel, isMerging) {
        this.kind = kind;
        this.inLevel = inLevel;
        this.outLevel = outLevel;
        this.isMerging = isMerging;
    }
}

const BELT_KINDS = [
    new BeltKindEntry(BELT_NORMAL, LANE_LEVEL_SURFACE, LANE_LEVEL_SURFACE, true),
    new BeltKindEntry(BELT_TUNNEL_DOWN, LANE_LEVEL_SURFACE, LANE_LEVEL_BURIED, false),
    new BeltKindEntry(BELT_TUNNEL_UP, LANE_LEVEL_BURIED, LANE_LEVEL_SURFACE, false),
    new BeltKindEntry(BELT_UNDERGROUND, LANE_LEVEL_BURIED, LANE_LEVEL_BURIED, false),
    new BeltKindEntry(BELT_RAMP_UP_1, LANE_LEVEL_SURFACE, LANE_LEVEL_ELEVATED_1, false),
    new BeltKindEntry(BELT_ELEVATED_1, LANE_LEVEL_ELEVATED_1, LANE_LEVEL_ELEVATED_1, true),
    new BeltKindEntry(BELT_RAMP_DOWN_1, LANE_LEVEL_ELEVATED_1, LANE_LEVEL_SURFACE, false),
];

/**
 * @param {BeltType} kind
 * @returns {BeltKindEntry}
 */
export function getBeltKindEntryByKind(kind) {
    // Declared in kind order, so the ordinal indexes the table.
    const entry = BELT_KINDS[kind];
    if (entry === undefined) {
        throw new Error(`No belt kind ${kind}`);
    }
    return entry;
}

/**
 * Whether a belt kind carries a run between two levels above ground; a tunnel mouth changes level
 * too, but one of its ends is buried.
 * @param {BeltType} kind
 * @returns {boolean}
 */
export function isBeltRamp(kind) {
    const entry = getBeltKindEntryByKind(kind);
    return entry.inLevel !== entry.outLevel
        && entry.inLevel >= LANE_LEVEL_SURFACE
        && entry.outLevel >= LANE_LEVEL_SURFACE;
}

/**
 * The build level a belt kind puts the belt tool on: the highest level it touches, and the ground
 * for the buried kinds, which the tool reaches by arming a tunnel rather than by standing there.
 * @param {BeltType} kind
 * @returns {LaneLevel}
 */
export function getBuildLevelByBeltKind(kind) {
    const entry = getBeltKindEntryByKind(kind);
    return Math.max(LANE_LEVEL_SURFACE, entry.inLevel, entry.outLevel);
}

/**
 * The level a belt kind draws at: its own when it stands off the surface at both ends, the same
 * rule that puts it on an elevated position layer, and the surface otherwise. A ramp keeps one end
 * on the ground, so it draws with the level below it.
 * @param {BeltType} kind
 * @returns {LaneLevel}
 */
export function getDrawLevelByBeltKind(kind) {
    const entry = getBeltKindEntryByKind(kind);
    if (entry.inLevel > LANE_LEVEL_SURFACE && entry.outLevel > LANE_LEVEL_SURFACE) {
        return Math.min(entry.inLevel, entry.outLevel);
    }
    return LANE_LEVEL_SURFACE;
}

/**
 * The kind taking flow at `inLevel` and handing it on at `outLevel`, or null when no belt makes
 * that step (climbing past the top level, descending below the surface).
 * @param {LaneLevel} inLevel
 * @param {LaneLevel} outLevel
 * @returns {BeltType|null}
 */
export function getBeltKindByLevelsOrNull(inLevel, outLevel) {
    const entry = BELT_KINDS.find(candidate => candidate.inLevel === inLevel && candidate.outLevel === outLevel);
    if (entry === undefined) {
        return null;
    }
    return entry.kind;
}

/**
 * @typedef {Object} TileStep
 * @property {number} dx
 * @property {number} dy
 */

/**
 * A belt kind ordinal (one of the BELT_* constants).
 * @typedef {number} BeltType
 */

/**
 * Per-step (dx, dy) for walking a mouth's tunnel: TUNNEL_UP steps against its facing, TUNNEL_DOWN along it.
 * @param {number} mouthType BELT_TUNNEL_UP or BELT_TUNNEL_DOWN
 * @param {Direction} direction the mouth's facing
 * @returns {TileStep}
 */
export function tunnelStep(mouthType, direction) {
    const sign = mouthType === BELT_TUNNEL_UP ? -1 : 1;
    return {dx: sign * Direction.dx(direction), dy: sign * Direction.dy(direction)};
}

/**
 * A belt bend ordinal.
 * @typedef {number} BeltBend
 */

export const BeltBend = {
    STRAIGHT: 0,
    LEFT: 1,
    RIGHT: 2,
};

// Workers one Housing contributes to its road network.
export const HOUSING_WORKER_SUPPLY = 5;

// Map-mode tile colors.
export const MAP_COLOR_HOUSING = 0x55a355;
export const MAP_COLOR_ROAD = 0xFFBF00;
export const MAP_COLOR_BELT = 0xf7df9e;
export const MAP_COLOR_BELT_TUNNEL = 0xc8a16e;
export const MAP_COLOR_BELT_RAMP = 0xe6b89c;
export const MAP_COLOR_BELT_ELEVATED_1 = 0xd8c49a;

// Roads draw below the worker figures (19) and the default object sprites (20).
export const DRAW_LAYER_ROAD = 18;

// Surface belts draw under the items riding them (15); elevated ones over the objects they pass
// (20), under the wires (30).
export const DRAW_LAYER_BELT = 10;
export const DRAW_LAYER_BELT_ELEVATED_1 = 25;

// Wire catenaries draw above objects and fills.
export const DRAW_LAYER_WIRES = 30;

// Maximum chebyshev length of a wire.
export const WIRE_LINK_RANGE = 10;

// Save tables of wires (any wireable endpoint pair).
export const LOGIC_WIRE_TABLE = "LogicWire";

// A terminal's starting tier.
export const LOGIC_TIER_BASE = 1;

// The gate's logic key (flat shared keyspace, see LOGIC_KEY_ENABLED in the engine).
export const LOGIC_KEY_OPEN = 2;

export const LOGIC_COMPARATOR_AT_LEAST = 0;
export const LOGIC_COMPARATOR_AT_MOST = 1;
export const LOGIC_COMPARATOR_EXACTLY = 2;
export const LOGIC_COMPARATOR_NOT = 3;
/** @typedef {number} LogicComparator */

/**
 * Whether a rule condition holds.
 * @param {LogicComparator} comparator
 * @param {number} value - the device's read value
 * @param {number} target - the rule's threshold
 * @returns {boolean}
 */
export function isLogicComparatorMatching(comparator, value, target) {
    if (comparator === LOGIC_COMPARATOR_AT_LEAST) {
        return value >= target;
    }
    if (comparator === LOGIC_COMPARATOR_AT_MOST) {
        return value <= target;
    }
    if (comparator === LOGIC_COMPARATOR_EXACTLY) {
        return value === target;
    }
    if (comparator === LOGIC_COMPARATOR_NOT) {
        return value !== target;
    }
    throw new Error(`Unknown logic comparator ${comparator}`);
}

// Rules one terminal may hold, and conditions one rule may AND together.
export const LOGIC_RULE_CAP = 16;
export const LOGIC_CONDITION_CAP = 4;

// DEVICE reads one device's key; STORED sums logicStored across the network for an item type.
export const LOGIC_CONDITION_KIND_DEVICE = 0;
export const LOGIC_CONDITION_KIND_STORED = 1;
/** @typedef {number} LogicConditionKind */

// Save tables of terminal rules and their conditions.
export const LOGIC_RULE_TABLE = "LogicRule";
export const LOGIC_CONDITION_TABLE = "LogicRuleCondition";

/**
 * Whether two tiles are within wire reach of each other.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {boolean}
 */
export function isWithinWireRange(x1, y1, x2, y2) {
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)) <= WIRE_LINK_RANGE;
}
