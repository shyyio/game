// Belt-specific conveniences for specs, built on the SDK's generic TestHarness.
// These wrap the mod's player messages so a test reads `createBelt(game, ...)`
// instead of constructing a CreateBeltMessage by hand. They live with the mod
// they serve — the harness itself (`@/sdk/test.js`) stays content-agnostic.

import {DeleteObjectMessage, CreateObjectMessage} from "@/sdk/common.js";
import {Belts} from "./Belts.js";
import {CreateBeltMessage} from "./messages.js";
import {SplitterDefinition} from "./objectTypes.js";

const BELT_NORMAL    = 0;
const BELT_RAMP_DOWN = 1;
const BELT_RAMP_UP   = 2;

/**
 * @enum
 */
export const GameObject = {
    BELT:      BELT_NORMAL,
    RAMP_DOWN: BELT_RAMP_DOWN,
    RAMP_UP:   BELT_RAMP_UP,
};

/**
 * Places a belt by dispatching a CreateBeltMessage through the harness, exactly
 * as a client would.
 * @param {TestHarness} game
 * @param {number} beltType
 * @param {{x: number, y: number, direction: Direction, rampParent?: number, disconnectRampChild?: number}} options
 */
export function createBelt(game, beltType, options) {
    game.dispatchMessage(new CreateBeltMessage(
        options.x,
        options.y,
        options.direction,
        beltType,
        options.rampParent,
        options.disconnectRampChild,
    ));
}

/**
 * Removes a belt by dispatching a DeleteObjectMessage.
 * @param {TestHarness} game
 * @param {number} id
 */
export function deleteBelt(game, id) {
    game.dispatchMessage(new DeleteObjectMessage(id));
}

/**
 * Places a splitter by dispatching a CreateObjectMessage.
 * @param {TestHarness} game
 * @param {{x: number, y: number, direction: Direction}} options
 */
export function createSplitter(game, options) {
    game.dispatchMessage(new CreateObjectMessage(
        SplitterDefinition.typeId,
        options.x,
        options.y,
        options.direction,
    ));
}

/**
 * Removes a splitter by dispatching a DeleteObjectMessage.
 * @param {TestHarness} game
 * @param {number} id
 */
export function deleteSplitter(game, id) {
    game.dispatchMessage(new DeleteObjectMessage(id));
}

/**
 * The engine's belt transport.
 * @param {GameEngine} sim
 * @returns {Belts}
 */
export function beltsOf(sim) {
    return sim.resolve(Belts);
}
