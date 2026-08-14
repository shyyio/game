// A fake SDK for a mod's own tests. Where the stub SDK (stubSdk.js) only has to survive being
// called, this one remembers what a mod passed it: `new ObjectType({name: "X", ...})` comes back
// with those properties on it, so a spec can assert on the content a declaration produced.
//
// It runs no game logic — nothing here places, ticks, or validates anything. A spec that needs the
// real engine belongs in the game repo; a mod's own specs are for the decisions the mod itself
// makes (ids, recipes, geometry, its own helpers).

/**
 * @param {string} name the SDK export being faked
 * @returns {Function} a class whose instances echo their constructor arguments
 */
function fakeClass(name) {
    return class Fake {

        /**
         * @param {...*} args whatever the mod passed
         */
        constructor(...args) {
            this.sdkClass = name;
            this.args = args;
            if (args.length > 0 && args[0] !== null && typeof args[0] === "object") {
                Object.assign(this, args[0]);
            } else if (typeof args[0] === "string") {
                // The positional constructors in the SDK all lead with a name.
                this.name = args[0];
            }
        }
    };
}

// Constants a mod reads off the SDK: real values so comparisons and arithmetic behave.
const CONSTANTS = {
    CHUNK_SIZE: 16,
    LAYER_SURFACE: 0,
    PLAYER_ID_NONE: 0,
    SDK_VERSION: 1,
    SETTING_ON: 0,
    SETTING_OFF: 1,
    EMPTY: 0,
    NO_EID: 0,
    NO_HOUSING: 0,
    TILE_SIZE: 16,
    TILE_HALF: 2048,
    Direction: {UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3},
    TickPhase: {
        SUBMIT_INTENTS: 1,
        RESOLVE_TRANSFERS: 2,
        CONSUME_INPUTS: 3,
        POST_RESOLVE: 4,
        PRODUCE_OUTPUTS: 5,
        COMMIT_TRANSFERS: 6,
        EMIT_RENDER: 7,
        EMIT_INSPECT: 8,
    },
    ViewMode: {WORLD: 0, MAP: 1, OVERWORLD: 2},
};

const cache = new Map();

/**
 * The module namespace a mod sees when it imports the SDK under test.
 * @returns {object}
 */
export function sdkFake() {
    return new Proxy({}, {
        get(unused, property) {
            if (typeof property === "symbol") {
                return undefined;
            }
            if (CONSTANTS[property] !== undefined) {
                return CONSTANTS[property];
            }
            if (!cache.has(property)) {
                cache.set(property, fakeClass(property));
            }
            return cache.get(property);
        },
        has() {
            return true;
        },
    });
}
