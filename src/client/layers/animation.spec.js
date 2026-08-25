import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {ANIMATION_FRAME_COUNT, advanceAnimationFrame, currentAnimationFrame} from "@/client/layers/animation.js";

const FRAME_MS = 1000 / 24;

/**
 * @param {number} steps
 * @returns {number} the frame `steps` ahead of the current one
 */
function ahead(steps) {
    return (currentAnimationFrame() + steps) % ANIMATION_FRAME_COUNT;
}

describe("animation clock", () => {
    it("holds the frame until a whole animation frame has elapsed", () => {
        const half = ahead(0);
        assert.equal(advanceAnimationFrame(FRAME_MS / 2), half);
        assert.equal(advanceAnimationFrame(FRAME_MS / 2), (half + 1) % ANIMATION_FRAME_COUNT);
    });

    it("advances at the same rate whatever the refresh rate", () => {
        // A second is 24 animation frames: a whole number of cycles.
        const at60 = ahead(0);
        for (let i = 0; i < 60; i++) {
            advanceAnimationFrame(1000 / 60);
        }
        assert.equal(currentAnimationFrame(), at60);
        // The same second at 144fps, then at 24.
        const at144 = ahead(0);
        for (let i = 0; i < 144; i++) {
            advanceAnimationFrame(1000 / 144);
        }
        assert.equal(currentAnimationFrame(), at144);
        const at24 = ahead(0);
        for (let i = 0; i < 24; i++) {
            advanceAnimationFrame(FRAME_MS);
        }
        assert.equal(currentAnimationFrame(), at24);
    });

    it("steps the whole count over a long delta, keeping the phase", () => {
        const start = ahead(0);
        assert.equal(advanceAnimationFrame(FRAME_MS * 3), (start + 3) % ANIMATION_FRAME_COUNT);
        // The leftover part-frame carries, so a half-frame delta still steps.
        const carried = ahead(0);
        advanceAnimationFrame(FRAME_MS * 1.5);
        assert.equal(advanceAnimationFrame(FRAME_MS * 0.5), (carried + 2) % ANIMATION_FRAME_COUNT);
    });
});
