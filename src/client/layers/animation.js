// Global sprite-animation clock.
//
// Convention: an animated sequence is named "<base>/0" .. "<base>/<n-1>" and holds 8 or 16 frames,
// played by indexing it with the current frame modulo its own length. The art is drawn for
// ANIMATION_FPS while the renderer runs at the display's refresh rate, so the frame steps off
// elapsed time. One global counter, so every animated sprite across every mod shows the same frame
// at the same instant. Mods animate by following the naming convention and reading
// currentAnimationFrame().

import ReducedMotion from "@/client/ReducedMotion.js";

// The counter's period: the longest sequence, and a multiple of every shorter one's length.
export const ANIMATION_CYCLE_FRAMES = 16;

// The cadence the art is drawn for.
const ANIMATION_FPS = 24;
const ANIMATION_FRAME_MS = 1000 / ANIMATION_FPS;

/**
 * The current global animation frame.
 * @type {number}
 */
let frame = 0;

/**
 * Carried since the last frame step, always under one frame.
 * @type {number}
 */
let elapsedMS = 0;

/**
 * Advances the clock by a rendered frame's elapsed time.
 * @param {number} deltaMS elapsed time since the previous rendered frame, in ms
 * @returns {number} the current frame, in [0, ANIMATION_CYCLE_FRAMES)
 */
export function advanceAnimationFrame(deltaMS) {
    if (ReducedMotion.isEnabled) {
        // Every sequence holds its base frame: no belt scroll, no cycling machines.
        elapsedMS = 0;
        frame = 0;
        return frame;
    }
    elapsedMS += deltaMS;
    if (elapsedMS < ANIMATION_FRAME_MS) {
        return frame;
    }
    // A slow frame spans several animation frames; stepping the whole count keeps the phase.
    const steps = Math.floor(elapsedMS / ANIMATION_FRAME_MS);
    elapsedMS -= steps * ANIMATION_FRAME_MS;
    frame = (frame + steps) % ANIMATION_CYCLE_FRAMES;
    return frame;
}

/**
 * The globally-synchronized animation frame for the current instant.
 * @returns {number} frame index in [0, ANIMATION_CYCLE_FRAMES)
 */
export function currentAnimationFrame() {
    return frame;
}
