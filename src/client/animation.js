// Global sprite-animation clock.
//
// Convention: every animated spritesheet sequence has exactly 8 frames, named
// "<base>/0" .. "<base>/7", and is played by showing "<base>/" plus the current
// frame. The Pixi ticker is capped at the game's frame rate (see Game.vue), so
// every tick advances exactly one frame. The frame is a single global counter, so
// every animated sprite, across every mod, shows the same frame at the same instant
// without any per-sprite state or phase. Mods animate simply by following this
// naming convention and reading currentAnimationFrame().

// 8 frames per sequence.
export const ANIMATION_FRAME_COUNT = 8;

/**
 * The current global animation frame.
 * @type {number}
 */
let frame = 0;

/**
 * Advances to the next frame, called once per ticker tick.
 * @returns {number} the new frame, in [0, 8)
 */
export function advanceAnimationFrame() {
    frame = (frame + 1) % ANIMATION_FRAME_COUNT;
    return frame;
}

/**
 * The globally-synchronized animation frame for the current instant.
 * @returns {number} frame index in [0, 8)
 */
export function currentAnimationFrame() {
    return frame;
}
