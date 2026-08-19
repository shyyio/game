import {test} from "node:test";
import assert from "node:assert/strict";
import {canonicalOrigin, formatCount, jwtExpiry} from "@/common/util.js";
import {ORIGIN_PATTERN} from "@/common/constants.js";

/**
 * @param {object} payload
 * @returns {string} a fake compact JWT with this payload; header/signature are unchecked
 */
function fakeToken(payload) {
    const base64url = part => Buffer.from(JSON.stringify(part)).toString("base64url");
    return `${base64url({alg: "none"})}.${base64url(payload)}.sig`;
}

test("jwtExpiry reads the exp claim from a compact JWT", () => {
    assert.equal(jwtExpiry(fakeToken({exp: 12345})), 12345);
});

test("jwtExpiry returns null for a malformed token or a missing/non-numeric exp", () => {
    assert.equal(jwtExpiry("not-a-jwt"), null);
    assert.equal(jwtExpiry(fakeToken({})), null);
    assert.equal(jwtExpiry(fakeToken({exp: "soon"})), null);
});

test("canonicalOrigin fills in the scheme's default port and lowercases the host", () => {
    assert.equal(canonicalOrigin("wss://example.com"), "wss://example.com:443");
    assert.equal(canonicalOrigin("ws://example.com"), "ws://example.com:80");
    assert.equal(canonicalOrigin(" wss://Example.com/ "), "wss://example.com:443");
});

test("canonicalOrigin keeps an explicit port", () => {
    assert.equal(canonicalOrigin("ws://localhost:27500"), "ws://localhost:27500");
    assert.equal(canonicalOrigin("wss://example.com:8443"), "wss://example.com:8443");
});

test("canonicalOrigin rejects anything that isn't a bare ws(s) origin", () => {
    assert.equal(canonicalOrigin("example.com"), "");
    assert.equal(canonicalOrigin("https://example.com"), "");
    assert.equal(canonicalOrigin("wss://example.com/game"), "");
    assert.equal(canonicalOrigin("wss://example.com?x=1"), "");
    assert.equal(canonicalOrigin("wss://user:pw@example.com"), "");
});

test("canonicalOrigin output matches the canonical origin pattern", () => {
    assert.equal(ORIGIN_PATTERN.test(canonicalOrigin("wss://Example.com")), true);
});

test("formatCount keeps counts within five characters", () => {
    assert.equal(formatCount(0), "0");
    assert.equal(formatCount(1), "1");
    assert.equal(formatCount(99_999), "99999");
    assert.equal(formatCount(100_000), "100K");
    assert.equal(formatCount(999_999), "999K");
    assert.equal(formatCount(1_500_000), "1500K");
    assert.equal(formatCount(9_999_999), "9999K");
    assert.equal(formatCount(10_000_000), "10M");
    assert.equal(formatCount(999_999_999), "999M");
    assert.equal(formatCount(1_000_000_000), "1B");
    assert.equal(formatCount(9_999_000_000_000), "9999B");
});

test("formatCount clamps beyond the widest unit", () => {
    assert.equal(formatCount(Number.MAX_SAFE_INTEGER), "9999B");
});

test("formatCount throws on anything but an unsigned integer", () => {
    assert.throws(() => formatCount(-1), RangeError);
    assert.throws(() => formatCount(-9_999_999), RangeError);
    assert.throws(() => formatCount(1.5), RangeError);
    assert.throws(() => formatCount(Number.NaN), RangeError);
    assert.throws(() => formatCount("100"), RangeError);
});
