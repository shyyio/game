import {test} from "node:test";
import assert from "node:assert/strict";
import {encodeFriendCode, decodeFriendCode} from "@/common/FriendCode.js";

test("round-trips through encode/decode", () => {
    for (const playerId of [1, 2, 42, 1000, 999999]) {
        assert.equal(decodeFriendCode(encodeFriendCode(playerId)), playerId);
    }
});

test("encodes as two groups of four separated by a dash", () => {
    assert.match(encodeFriendCode(42), /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
});

test("decode is case-insensitive and tolerates missing/extra dashes and spaces", () => {
    const code = encodeFriendCode(42);
    const bare = code.replace("-", "");
    assert.equal(decodeFriendCode(code.toLowerCase()), 42);
    assert.equal(decodeFriendCode(bare), 42);
    assert.equal(decodeFriendCode(` ${code} `.replace("-", " ")), 42);
});

test("malformed codes decode to null", () => {
    assert.equal(decodeFriendCode("ABC-DEF"), null, "wrong length after stripping");
    assert.equal(decodeFriendCode("IIII-LLLL"), null, "ambiguous letters excluded from the alphabet");
    assert.equal(decodeFriendCode(""), null);
});
