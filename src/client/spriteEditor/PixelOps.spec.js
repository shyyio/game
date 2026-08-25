import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {applyTint, drawLine, drawRect, floodFill, getPixel, paletteOf, setBlock, fromHex, toHex} from "@/client/spriteEditor/PixelOps.js";

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

function buffer(width, height) {
    return {width, height, data: new Uint8ClampedArray(width * height * 4)};
}

describe("PixelOps", () => {
    it("setBlock fills the aligned block", () => {
        const b = buffer(4, 4);
        setBlock(b, 3, 1, RED, 2);
        assert.deepEqual(getPixel(b, 2, 0), RED);
        assert.deepEqual(getPixel(b, 3, 1), RED);
        assert.deepEqual(getPixel(b, 1, 1), CLEAR);
        assert.deepEqual(getPixel(b, 2, 2), CLEAR);
    });

    it("drawLine connects diagonal blocks without gaps", () => {
        const b = buffer(8, 8);
        drawLine(b, 0, 0, 7, 7, RED, 2);
        for (let i = 0; i < 4; i++) {
            assert.deepEqual(getPixel(b, i * 2, i * 2), RED);
        }
        assert.deepEqual(getPixel(b, 0, 2), CLEAR);
    });

    it("drawRect outlines only", () => {
        const b = buffer(6, 6);
        drawRect(b, 0, 0, 5, 5, RED, 1);
        assert.deepEqual(getPixel(b, 0, 3), RED);
        assert.deepEqual(getPixel(b, 5, 3), RED);
        assert.deepEqual(getPixel(b, 3, 0), RED);
        assert.deepEqual(getPixel(b, 2, 2), CLEAR);
    });

    it("floodFill stops at a different color and respects blocks", () => {
        const b = buffer(6, 6);
        drawLine(b, 2, 0, 2, 5, RED, 2);
        floodFill(b, 0, 0, BLUE, 2);
        assert.deepEqual(getPixel(b, 1, 5), BLUE);
        assert.deepEqual(getPixel(b, 2, 3), RED);
        assert.deepEqual(getPixel(b, 5, 5), CLEAR);
        // Filling with the same color is a no-op.
        floodFill(b, 5, 5, CLEAR, 2);
        assert.deepEqual(getPixel(b, 5, 5), CLEAR);
    });

    it("paletteOf orders by frequency and skips transparent", () => {
        const b = buffer(4, 1);
        setBlock(b, 0, 0, RED, 1);
        setBlock(b, 1, 0, BLUE, 1);
        setBlock(b, 2, 0, BLUE, 1);
        assert.deepEqual(paletteOf(b, 8), [BLUE, RED]);
        assert.deepEqual(paletteOf(b, 1), [BLUE]);
    });

    it("applyTint multiplies the channels and keeps alpha", () => {
        const b = buffer(2, 1);
        setBlock(b, 0, 0, [255, 128, 64, 200], 1);
        applyTint(b, fromHex("#ff8000", 255));
        assert.deepEqual(getPixel(b, 0, 0), [255, 64, 0, 200]);
        // White is pixi's untinted tint.
        setBlock(b, 1, 0, [10, 20, 30, 40], 1);
        applyTint(b, fromHex("#ffffff", 255));
        assert.deepEqual(getPixel(b, 1, 0), [10, 20, 30, 40]);
    });

    it("hex round-trips", () => {
        assert.equal(toHex([255, 16, 0, 255]), "#ff1000");
        assert.deepEqual(fromHex("#ff1000", 128), [255, 16, 0, 128]);
    });
});
