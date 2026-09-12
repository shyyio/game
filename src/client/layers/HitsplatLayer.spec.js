import {test} from "node:test";
import assert from "node:assert/strict";
import {
    HITSPLAT_DURATION_MS,
    HITSPLAT_RISE,
    hitsplatOffsetY,
    hitsplatAlpha,
    hitsplatJitterOffset,
    measureHitsplat,
} from "@/client/layers/HitsplatLayer.js";

// A stand-in for the installed bitmap font: the advances the layout reads, nothing else.
const FONT = {chars: {"1": {xAdvance: 30}, "2": {xAdvance: 40}, "k": {xAdvance: 50}}};

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

test("a run measures the sum of its glyph advances", () => {
    assert.equal(measureHitsplat(FONT, "12k"), 120);
    assert.equal(measureHitsplat(FONT, ""), 0);
});

test("a character the font has no glyph for takes no width", () => {
    assert.equal(measureHitsplat(FONT, "1?2"), 70);
});
