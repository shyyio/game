// Cross-service: boots a real auth server and verifies the game server's JwksVerifier against its
// JWKS, so it sits here rather than beside either service.

import {test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {NodeAccountStore} from "@/authserver/NodeAccountStore.js";
import {AccountRegistry} from "@/authserver/AccountRegistry.js";
import {SigningKeys} from "@/authserver/SigningKeys.js";
import {JoinTokenService} from "@/authserver/JoinTokenService.js";
import {AuthHttpServer} from "@/authserver/AuthHttpServer.js";
import {JwksVerifier} from "@/server/JwksVerifier.js";

const ORIGIN = "wss://example.com:443";

/**
 * @returns {Promise<{server: AuthHttpServer, signingKeys: SigningKeys, joinTokens: JoinTokenService, accounts: AccountRegistry, baseUrl: string}>}
 */
async function startAuthServer() {
    const dir = mkdtempSync(join(tmpdir(), "jwks-verifier-"));
    const accounts = new AccountRegistry(new NodeAccountStore());
    const signingKeys = new SigningKeys(join(dir, "signing-key.json"));
    const joinTokens = new JoinTokenService(signingKeys, randomBytes(32));
    const server = new AuthHttpServer(accounts, signingKeys, joinTokens);
    await server.listen("127.0.0.1", 0);
    return {server, signingKeys, joinTokens, accounts, baseUrl: `http://127.0.0.1:${server.port}`};
}

/**
 * Builds a token by hand (bypassing JoinTokenService's fixed TTL) so exp can be forced into the past.
 * @param {SigningKeys} signingKeys
 * @param {object} payload
 * @returns {string}
 */
function buildToken(signingKeys, payload) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const signingInput = `${encode({alg: "EdDSA", kid: signingKeys.kid})}.${encode(payload)}`;
    const signature = signingKeys.sign(Buffer.from(signingInput));
    return `${signingInput}.${signature.toString("base64url")}`;
}

test("verifies a real token minted by the auth server", async () => {
    const {server, joinTokens, accounts, baseUrl} = await startAuthServer();
    try {
        const verifier = new JwksVerifier(baseUrl);
        await verifier.load();
        const account = accounts.getOrCreate("alice");
        const token = joinTokens.mint(account, ORIGIN);
        const claims = verifier.verify(token, ORIGIN);
        assert.notEqual(claims, null);
        assert.equal(claims.name, "alice");
        assert.equal(typeof claims.sub, "string");
    } finally {
        server.stop();
    }
});

test("rejects a token minted for a different origin", async () => {
    const {server, joinTokens, accounts, baseUrl} = await startAuthServer();
    try {
        const verifier = new JwksVerifier(baseUrl);
        await verifier.load();
        const account = accounts.getOrCreate("alice");
        const token = joinTokens.mint(account, "wss://other.example:443");
        assert.equal(verifier.verify(token, ORIGIN), null);
    } finally {
        server.stop();
    }
});

test("rejects a tampered signature", async () => {
    const {server, joinTokens, accounts, baseUrl} = await startAuthServer();
    try {
        const verifier = new JwksVerifier(baseUrl);
        await verifier.load();
        const account = accounts.getOrCreate("alice");
        const token = joinTokens.mint(account, ORIGIN);
        const [header, payload, signature] = token.split(".");
        // Flips the first char, not the last: base64url's final char can carry unused padding
        // bits, so tampering it can decode back to the same bytes and the test would flake.
        const tampered = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
        assert.equal(verifier.verify(`${header}.${payload}.${tampered}`, ORIGIN), null);
    } finally {
        server.stop();
    }
});

test("rejects an expired token", async () => {
    const {server, signingKeys, baseUrl} = await startAuthServer();
    try {
        const verifier = new JwksVerifier(baseUrl);
        await verifier.load();
        const nowS = Math.floor(Date.now() / 1000);
        const token = buildToken(signingKeys, {sub: "abc", aud: ORIGIN, name: "alice", ent: [], exp: nowS - 1});
        assert.equal(verifier.verify(token, ORIGIN), null);
    } finally {
        server.stop();
    }
});

test("rejects malformed tokens and unknown kids", async () => {
    const {server, baseUrl} = await startAuthServer();
    try {
        const verifier = new JwksVerifier(baseUrl);
        await verifier.load();
        assert.equal(verifier.verify("not-a-token", ORIGIN), null);
        assert.equal(verifier.verify("a.b", ORIGIN), null);
        const bogusHeader = Buffer.from(JSON.stringify({alg: "EdDSA", kid: "nope"})).toString("base64url");
        const bogusPayload = Buffer.from(JSON.stringify({sub: "x", aud: ORIGIN, exp: 9999999999})).toString("base64url");
        assert.equal(verifier.verify(`${bogusHeader}.${bogusPayload}.aaaa`, ORIGIN), null);
    } finally {
        server.stop();
    }
});
