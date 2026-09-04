import {test} from "node:test";
import assert from "node:assert/strict";
import {createHmac, createPublicKey, randomBytes, verify} from "node:crypto";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SigningKeys} from "@/authserver/SigningKeys.js";
import {TokenService, RECONNECT_ABSOLUTE_TTL_S} from "@/authserver/TokenService.js";
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
    const tokens = new TokenService(signingKeys, randomBytes(32));
    const account = new AccountRecord(1, "alice", 0);
    const token = tokens.mint(account, ORIGIN);

    const [headerPart, payloadPart, signaturePart] = token.split(".");
    const publicKey = createPublicKey({key: signingKeys.toJwk(), format: "jwk"});
    const signingInput = Buffer.from(`${headerPart}.${payloadPart}`);
    const signature = Buffer.from(signaturePart, "base64url");
    assert.equal(verify(null, signingInput, publicKey, signature), true);
});

test("claims match the doc: aud, name, short exp, empty entitlements", () => {
    const tokens = new TokenService(freshSigningKeys(), randomBytes(32));
    const account = new AccountRecord(1, "alice", 0);
    const nowS = Math.floor(Date.now() / 1000);
    const payload = decodePayload(tokens.mint(account, ORIGIN));

    assert.equal(payload.aud, ORIGIN);
    assert.equal(payload.name, "alice");
    assert.deepEqual(payload.ent, []);
    assert.equal(payload.exp > nowS, true);
    assert.equal(payload.exp <= nowS + 300, true);
});

test("sub is pairwise: stable per (account, origin), differs across either", () => {
    const authSecret = randomBytes(32);
    const tokens = new TokenService(freshSigningKeys(), authSecret);
    const alice = new AccountRecord(1, "alice", 0);
    const bob = new AccountRecord(2, "bob", 0);

    const aliceAgain = decodePayload(tokens.mint(alice, ORIGIN));
    const aliceSameOrigin = decodePayload(tokens.mint(alice, ORIGIN));
    const aliceOtherOrigin = decodePayload(tokens.mint(alice, "wss://other.example:443"));
    const bobSameOrigin = decodePayload(tokens.mint(bob, ORIGIN));

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

test("origin pattern requires a port inside the 1-65535 range", () => {
    assert.equal(ORIGIN_PATTERN.test("wss://example.com:1"), true);
    assert.equal(ORIGIN_PATTERN.test("wss://example.com:65535"), true);
    assert.equal(ORIGIN_PATTERN.test("wss://example.com:65536"), false, "past the range");
    assert.equal(ORIGIN_PATTERN.test("wss://example.com:99999"), false, "past the range");
    assert.equal(ORIGIN_PATTERN.test("wss://example.com:0"), false, "port zero");
    assert.equal(ORIGIN_PATTERN.test("wss://example.com:0443"), false, "leading zero");
});

test("a fresh reconnect token verifies and carries its issue time", () => {
    const tokens = new TokenService(freshSigningKeys(), randomBytes(32));
    const nowS = Math.floor(Date.now() / 1000);

    const claims = tokens.verifyReconnect(tokens.mintReconnect(new AccountRecord(7, "alice", 0), ORIGIN));

    assert.equal(claims.accountId, 7);
    assert.equal(claims.origin, ORIGIN);
    assert.ok(Math.abs(claims.issuedAtS - nowS) <= 1);
});

test("a renewal carries the original issue time forward", () => {
    const tokens = new TokenService(freshSigningKeys(), randomBytes(32));
    const issuedAtS = Math.floor(Date.now() / 1000) - 3600;

    const renewed = tokens.renewReconnect({accountId: 7, origin: ORIGIN, issuedAtS});

    assert.deepEqual(tokens.verifyReconnect(renewed), {accountId: 7, origin: ORIGIN, issuedAtS});
});

test("a renewal chain past the absolute lifetime is refused", () => {
    const tokens = new TokenService(freshSigningKeys(), randomBytes(32));
    const issuedAtS = Math.floor(Date.now() / 1000) - RECONNECT_ABSOLUTE_TTL_S - 1;

    const renewed = tokens.renewReconnect({accountId: 7, origin: ORIGIN, issuedAtS});

    assert.equal(tokens.verifyReconnect(renewed), null);
});

test("a forged reconnect signature is refused", () => {
    const tokens = new TokenService(freshSigningKeys(), randomBytes(32));
    const [payload] = tokens.mintReconnect(new AccountRecord(7, "alice", 0), ORIGIN).split(".");
    const forger = new TokenService(freshSigningKeys(), randomBytes(32));

    const forged = forger.mintReconnect(new AccountRecord(7, "alice", 0), ORIGIN);

    assert.equal(tokens.verifyReconnect(forged), null, "signed with another secret");
    assert.equal(tokens.verifyReconnect(payload), null, "no signature at all");
    assert.equal(tokens.verifyReconnect(`${payload}.deadbeef`), null, "truncated signature");
});

test("a session token verifies to its accountId", () => {
    const tokens = new TokenService(freshSigningKeys(), randomBytes(32));

    assert.equal(tokens.verifySession(tokens.mintSession(7)), 7);
});

test("a session token signed with another secret, unsigned, or expired is refused", () => {
    const authSecret = randomBytes(32);
    const tokens = new TokenService(freshSigningKeys(), authSecret);
    const forger = new TokenService(freshSigningKeys(), randomBytes(32));
    const [payload] = tokens.mintSession(7).split(".");
    const expiredPayload = Buffer.from(JSON.stringify({sub: 7, exp: Math.floor(Date.now() / 1000) - 1})).toString("base64url");
    const expiredSignature = createHmac("sha256", authSecret).update(`session:${expiredPayload}`).digest("base64url");

    assert.equal(tokens.verifySession(forger.mintSession(7)), null, "signed with another secret");
    assert.equal(tokens.verifySession(payload), null, "no signature at all");
    assert.equal(tokens.verifySession(`${expiredPayload}.${expiredSignature}`), null, "expired");
});

test("a correctly signed token whose payload is not an object is refused", () => {
    const authSecret = randomBytes(32);
    const tokens = new TokenService(freshSigningKeys(), authSecret);
    const payload = Buffer.from("null").toString("base64url");
    const signature = createHmac("sha256", authSecret).update(`session:${payload}`).digest("base64url");

    assert.equal(tokens.verifySession(`${payload}.${signature}`), null);
});
