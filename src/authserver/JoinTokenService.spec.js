import {test} from "node:test";
import assert from "node:assert/strict";
import {createPublicKey, randomBytes, verify} from "node:crypto";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SigningKeys} from "@/authserver/SigningKeys.js";
import {JoinTokenService} from "@/authserver/JoinTokenService.js";
import {AccountRecord} from "@/authserver/AccountRegistry.js";
import {ORIGIN_PATTERN} from "@/common/constants.js";

const ORIGIN = "wss://example.com:443";

/**
 * @returns {SigningKeys}
 */
function freshSigningKeys() {
    const dir = mkdtempSync(join(tmpdir(), "authserver-join-tokens-"));
    return new SigningKeys(join(dir, "signing-key.json"));
}

/**
 * @param {string} token
 * @returns {object}
 */
function decodePayload(token) {
    const [, payload] = token.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

test("mint produces a token whose signature verifies against the published JWK", () => {
    const signingKeys = freshSigningKeys();
    const joinTokens = new JoinTokenService(signingKeys, randomBytes(32));
    const account = new AccountRecord(1, "alice", 0);
    const token = joinTokens.mint(account, ORIGIN);

    const [headerPart, payloadPart, signaturePart] = token.split(".");
    const publicKey = createPublicKey({key: signingKeys.toJwk(), format: "jwk"});
    const signingInput = Buffer.from(`${headerPart}.${payloadPart}`);
    const signature = Buffer.from(signaturePart, "base64url");
    assert.equal(verify(null, signingInput, publicKey, signature), true);
});

test("claims match the doc: aud, name, short exp, empty entitlements", () => {
    const joinTokens = new JoinTokenService(freshSigningKeys(), randomBytes(32));
    const account = new AccountRecord(1, "alice", 0);
    const nowS = Math.floor(Date.now() / 1000);
    const payload = decodePayload(joinTokens.mint(account, ORIGIN));

    assert.equal(payload.aud, ORIGIN);
    assert.equal(payload.name, "alice");
    assert.deepEqual(payload.ent, []);
    assert.equal(payload.exp > nowS, true);
    assert.equal(payload.exp <= nowS + 300, true);
});

test("sub is pairwise: stable per (account, origin), differs across either", () => {
    const authSecret = randomBytes(32);
    const joinTokens = new JoinTokenService(freshSigningKeys(), authSecret);
    const alice = new AccountRecord(1, "alice", 0);
    const bob = new AccountRecord(2, "bob", 0);

    const aliceAgain = decodePayload(joinTokens.mint(alice, ORIGIN));
    const aliceSameOrigin = decodePayload(joinTokens.mint(alice, ORIGIN));
    const aliceOtherOrigin = decodePayload(joinTokens.mint(alice, "wss://other.example:443"));
    const bobSameOrigin = decodePayload(joinTokens.mint(bob, ORIGIN));

    assert.equal(aliceAgain.sub, aliceSameOrigin.sub);
    assert.notEqual(aliceAgain.sub, aliceOtherOrigin.sub);
    assert.notEqual(aliceAgain.sub, bobSameOrigin.sub);
});

test("origin pattern requires scheme, lowercase host, explicit port", () => {
    assert.equal(ORIGIN_PATTERN.test("wss://example.com:443"), true);
    assert.equal(ORIGIN_PATTERN.test("ws://localhost:27500"), true);
    assert.equal(ORIGIN_PATTERN.test("wss://Example.com:443"), false, "uppercase host");
    assert.equal(ORIGIN_PATTERN.test("wss://example.com"), false, "missing port");
    assert.equal(ORIGIN_PATTERN.test("wss://example.com:443/"), false, "trailing slash");
});
