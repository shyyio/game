// Origin-scoped reconnect tokens: what a page running mod code is allowed to hold. They buy fresh
// join tokens for one server and nothing else, so the account session can be dropped before any mod
// is evaluated (see docs/mod-distribution.md's threat model).

import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {NodeAccountStore} from "@/authserver/NodeAccountStore.js";
import {AccountRegistry} from "@/authserver/AccountRegistry.js";
import {SigningKeys} from "@/authserver/SigningKeys.js";
import {TokenService} from "@/authserver/TokenService.js";
import {AuthHttpServer} from "@/authserver/AuthHttpServer.js";
import {ServerDirectory} from "@/authserver/ServerDirectory.js";

const ORIGIN = "wss://play.example.com:443";
const OTHER_ORIGIN = "wss://other.example.com:443";

/**
 * @param {object} t
 * @returns {{tokens: TokenService, accounts: AccountRegistry, signingKeys: SigningKeys}}
 */
function services(t) {
    const dir = mkdtempSync(join(tmpdir(), "pipes-reconnect-"));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    const signingKeys = new SigningKeys(join(dir, "signing-key.json"));
    return {
        signingKeys,
        accounts: new AccountRegistry(new NodeAccountStore()),
        tokens: new TokenService(signingKeys, randomBytes(32)),
    };
}

/**
 * @param {string} token
 * @returns {object} a join token's claims
 */
function claimsOf(token) {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

test("a reconnect token names the account and the one origin it is good for", (t) => {
    const {accounts, tokens} = services(t);
    const account = accounts.getOrCreate("player");

    const verified = tokens.verifyReconnect(tokens.mintReconnect(account, ORIGIN));

    assert.equal(verified.accountId, account.accountId);
    assert.equal(verified.origin, ORIGIN);
});

test("a forged or tampered reconnect token verifies to nothing", (t) => {
    const {accounts, tokens} = services(t);
    const account = accounts.getOrCreate("player");
    const token = tokens.mintReconnect(account, ORIGIN);
    const [payload, signature] = token.split(".");
    const swapped = Buffer.from(JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        aud: OTHER_ORIGIN,
    })).toString("base64url");

    assert.equal(tokens.verifyReconnect(`${swapped}.${signature}`), null, "the origin is signed over");
    assert.equal(tokens.verifyReconnect(`${payload}.${"a".repeat(43)}`), null);
    assert.equal(tokens.verifyReconnect("nonsense"), null);
    assert.equal(tokens.verifyReconnect(undefined), null);
});

test("an expired reconnect token stops working", (t) => {
    const {accounts, tokens} = services(t);
    const account = accounts.getOrCreate("player");
    const realNow = Date.now;
    Date.now = () => realNow() - 13 * 60 * 60 * 1000;
    const stale = tokens.mintReconnect(account, ORIGIN);
    Date.now = realNow;

    assert.equal(tokens.verifyReconnect(stale), null);
});

test("/join hands out a reconnect token, and /rejoin spends it for this origin only", async (t) => {
    const {accounts, tokens, signingKeys} = services(t);
    const dir = mkdtempSync(join(tmpdir(), "pipes-reconnect-http-"));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    const server = new AuthHttpServer(accounts, signingKeys, tokens, new ServerDirectory(join(dir, "servers.json")));
    await server.listen("127.0.0.1", 0);
    try {
        const baseUrl = `http://127.0.0.1:${server.port}`;
        const login = await (await fetch(`${baseUrl}/login`, {method: "POST", body: JSON.stringify({username: "player"})})).json();
        const joined = await (await fetch(`${baseUrl}/join`, {
            method: "POST",
            headers: {authorization: `Bearer ${login.sessionToken}`},
            body: JSON.stringify({origin: ORIGIN}),
        })).json();
        assert.equal(typeof joined.reconnect, "string");

        // A reconnect needs no account session at all.
        const rejoined = await (await fetch(`${baseUrl}/rejoin`, {
            method: "POST",
            body: JSON.stringify({reconnect: joined.reconnect}),
        })).json();
        assert.equal(claimsOf(rejoined.token).aud, ORIGIN);
        assert.equal(claimsOf(rejoined.token).sub, claimsOf(joined.token).sub, "the pairwise subject is stable");
        assert.equal(typeof rejoined.reconnect, "string");

        const forged = await fetch(`${baseUrl}/rejoin`, {method: "POST", body: JSON.stringify({reconnect: "nope"})});
        assert.equal(forged.status, 401);
    } finally {
        server.stop();
    }
});
