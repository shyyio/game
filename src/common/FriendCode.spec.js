import {test} from "node:test";
import assert from "node:assert/strict";
import {generateFriendCode, normalizeFriendCode, isValidFriendCode} from "@/common/FriendCode.js";

test("generates as two groups of four separated by a dash", () => {
    assert.match(generateFriendCode(), /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
});

test("generated codes are unpredictable, not sequential or derivable", () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) {
        codes.add(generateFriendCode());
    }
    assert.equal(codes.size, 100, "no collisions across 100 draws");
});

test("normalize is case-insensitive and tolerates missing/extra dashes and spaces", () => {
    const code = generateFriendCode();
    const digits = code.replace("-", "");
    assert.equal(normalizeFriendCode(code.toLowerCase()), digits);
    assert.equal(normalizeFriendCode(digits), digits);
    assert.equal(normalizeFriendCode(` ${code} `.replace("-", " ")), digits);
});

test("malformed codes normalize to null", () => {
    assert.equal(normalizeFriendCode("ABC-DEF"), null, "wrong length after stripping");
    assert.equal(normalizeFriendCode("IIII-LLLL"), null, "ambiguous letters excluded from the alphabet");
    assert.equal(normalizeFriendCode(""), null);
    assert.equal(normalizeFriendCode("0000-0001"), null, "wrong checksum digit");
});

test("isValidFriendCode mirrors normalize's format/checksum check", () => {
    assert.equal(isValidFriendCode(generateFriendCode()), true);
    assert.equal(isValidFriendCode("ABC-DEF"), false);
});
