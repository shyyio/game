import {test} from "node:test";
import assert from "node:assert/strict";
import {jwtExpiry} from "@/common/util.js";

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
