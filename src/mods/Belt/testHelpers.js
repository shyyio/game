// Belt-specific conveniences for specs, built on the SDK's generic TestHarness.
// These wrap the mod's player messages so a test reads `createBelt(game, ...)`
// instead of constructing a CreateBeltMessage by hand. They live with the mod
// they serve — the harness itself (`@/sdk/test.js`) stays content-agnostic.

import {
    CreateBeltMessage,
    DeleteBeltMessage,
    CreateSplitterMessage,
    DeleteSplitterMessage,
} from "./messages.js";

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
 * @param {{x: number, y: number, direction: Direction, rampParent?: BigInt, disconnectRampChild?: BigInt}} options
 */
export function createBelt(game, beltType, options) {
    game.dispatchMessage(new CreateBeltMessage({
        x: options.x,
        y: options.y,
        direction: options.direction,
        beltType,
        rampParent: options.rampParent,
        disconnectRampChild: options.disconnectRampChild,
    }));
}

/**
 * Removes a belt by dispatching a DeleteBeltMessage.
 * @param {TestHarness} game
 * @param {BigInt} id
 */
export function deleteBelt(game, id) {
    game.dispatchMessage(new DeleteBeltMessage(id));
}

/**
 * Places a splitter by dispatching a CreateSplitterMessage.
 * @param {TestHarness} game
 * @param {{x: number, y: number, direction: Direction}} options
 */
export function createSplitter(game, options) {
    game.dispatchMessage(new CreateSplitterMessage({
        x: options.x,
        y: options.y,
        direction: options.direction,
    }));
}

/**
 * Removes a splitter by dispatching a DeleteSplitterMessage.
 * @param {TestHarness} game
 * @param {BigInt} id
 */
export function deleteSplitter(game, id) {
    game.dispatchMessage(new DeleteSplitterMessage(id));
}
