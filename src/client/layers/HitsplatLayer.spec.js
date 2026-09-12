import {test} from "node:test";
import assert from "node:assert/strict";
import {
    HITSPLAT_DURATION_MS,
    HITSPLAT_RISE,
    hitsplatOffsetY,
    hitsplatAlpha,
    hitsplatJitterOffset,
    hitsplatRunWidth,
    isRenderStalled,
    HITSPLAT_ICON_SIZE,
    HITSPLAT_STALL_MS,
} from "@/client/layers/HitsplatLayer.js";

test("a splat starts on its tile and ends a full rise above it", () => {
    // === so the signed zero the rise starts at still reads as no offset.
    assert.ok(hitsplatOffsetY(0) === 0);
    assert.equal(hitsplatOffsetY(1), -HITSPLAT_RISE);
});

test("the rise only ever climbs", () => {
    let previous = 1;
    for (let elapsedMS = 0; elapsedMS <= HITSPLAT_DURATION_MS; elapsedMS += 50) {
        const offsetY = hitsplatOffsetY(elapsedMS / HITSPLAT_DURATION_MS);
        assert.ok(offsetY < previous);
        previous = offsetY;
    }
});

test("a splat holds opaque, then fades out by the end", () => {
    assert.equal(hitsplatAlpha(0), 1);
    assert.ok(hitsplatAlpha(0.5) > 0.9);
    assert.ok(hitsplatAlpha(0.9) < 0.5);
    assert.equal(hitsplatAlpha(1), 0);
});

test("no jitter puts the splat dead center, and the random extremes reach the radius", () => {
    assert.equal(hitsplatJitterOffset(0.5, 0.5), 0);
    assert.equal(hitsplatJitterOffset(0.5, 0), -0.5);
    assert.equal(hitsplatJitterOffset(0.5, 1), 0.5);
    // === so the signed zero a zero radius produces still reads as no offset.
    assert.ok(hitsplatJitterOffset(0, 0) === 0);
});

test("a trailing icon widens the run by its own box, and nothing widens it without one", () => {
    assert.equal(hitsplatRunWidth(100, false), 100);
    assert.ok(hitsplatRunWidth(100, true) > 100 + HITSPLAT_ICON_SIZE);
});

test("a frame gap only counts as stalled once it is past a dropped-frames pause", () => {
    assert.equal(isRenderStalled(16), false);
    assert.equal(isRenderStalled(HITSPLAT_STALL_MS), false);
    assert.equal(isRenderStalled(HITSPLAT_STALL_MS + 1), true);
});
