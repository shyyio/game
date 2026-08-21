import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {hexToHsl, hslToHex} from "@/client/spriteEditor/color.js";

describe("color", () => {
    it("converts primaries", () => {
        assert.deepEqual(hexToHsl("#ff0000"), {h: 0, s: 100, l: 50});
        assert.deepEqual(hexToHsl("#00ff00"), {h: 120, s: 100, l: 50});
        assert.deepEqual(hexToHsl("#0000ff"), {h: 240, s: 100, l: 50});
        assert.deepEqual(hexToHsl("#808080"), {h: 0, s: 0, l: 50});
        assert.equal(hslToHex(0, 100, 50), "#ff0000");
        assert.equal(hslToHex(120, 100, 50), "#00ff00");
        assert.equal(hslToHex(0, 0, 100), "#ffffff");
        assert.equal(hslToHex(0, 0, 0), "#000000");
    });

    it("round-trips within rounding", () => {
        for (const hex of ["#ffe2a0", "#2b1d0e", "#1a73e8", "#c8a26a"]) {
            const {h, s, l} = hexToHsl(hex);
            const back = hslToHex(h, s, l);
            for (let i = 1; i < 7; i += 2) {
                assert.ok(Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(back.slice(i, i + 2), 16)) <= 3, `${hex} -> ${back}`);
            }
        }
    });
});
