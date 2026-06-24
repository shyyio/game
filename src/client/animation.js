// 8 frames per sequence, played at 24fps.
const ANIMATION_FRAME_COUNT = 8;
const ANIMATION_FRAME_MS = 1000 / 24;

/**
 * Milliseconds accumulated from the Pixi ticker since startup.
 * @type {number}
 */
let elapsedMS = 0;

/**
 * Advances the animation clock by one ticker step. Driven by the render loop
 * (Client), so the clock is measured off the Pixi ticker rather than wall time.
 * @param {number} deltaMS milliseconds elapsed since the previous tick
 */
export function advanceAnimationClock(deltaMS) {
    elapsedMS += deltaMS;
}

/**
 * The globally-synchronized animation frame for the current instant.
 * @returns {number} frame index in [0, 8)
 */
export function currentAnimationFrame() {
    return Math.floor(elapsedMS / ANIMATION_FRAME_MS) % ANIMATION_FRAME_COUNT;
}
