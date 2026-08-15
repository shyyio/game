import {test} from "node:test";
import assert from "node:assert/strict";
import {canonicalOrigin, jwtExpiry} from "@/common/util.js";
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
