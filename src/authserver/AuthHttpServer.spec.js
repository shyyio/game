import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {NodeAccountStore} from "@/authserver/NodeAccountStore.js";
import {AccountRegistry} from "@/authserver/AccountRegistry.js";
import {SigningKeys} from "@/authserver/SigningKeys.js";
import {JoinTokenService} from "@/authserver/JoinTokenService.js";
import {AuthHttpServer, MAX_SESSIONS_PER_ACCOUNT} from "@/authserver/AuthHttpServer.js";
import {ServerDirectory} from "@/authserver/ServerDirectory.js";

const SIGNING_KEY_PATH = join(mkdtempSync(join(tmpdir(), "authserver-http-")), "signing-key.json");

/**
 * @param {string} [serversPath] - the server directory's JSON file; absent means no such file
 * @returns {Promise<{server: AuthHttpServer, store: NodeAccountStore, baseUrl: string}>}
 */
async function startServer(serversPath=join(mkdtempSync(join(tmpdir(), "authserver-servers-")), "servers.json")) {
    const store = new NodeAccountStore();
    const accounts = new AccountRegistry(store);
    const signingKeys = new SigningKeys(SIGNING_KEY_PATH);
    const joinTokens = new JoinTokenService(signingKeys, randomBytes(32));
    const server = new AuthHttpServer(accounts, signingKeys, joinTokens, new ServerDirectory(serversPath));
    await server.listen("127.0.0.1", 0);
    return {server, store, baseUrl: `http://127.0.0.1:${server.port}`};
}

/**
 * @param {string} baseUrl
 * @param {string} username
 * @returns {Promise<string>} sessionToken
 */
async function login(baseUrl, username) {
    const response = await fetch(`${baseUrl}/login`, {method: "POST", body: JSON.stringify({username})});
    const body = await response.json();
    return body.sessionToken;
}

test("a CORS preflight for /join succeeds with the right headers", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const response = await fetch(`${baseUrl}/join`, {
            method: "OPTIONS",
            headers: {
                origin: "http://localhost:5173",
                "access-control-request-method": "POST",
                "access-control-request-headers": "authorization,content-type",
            },
        });
        assert.equal(response.status, 204);
        assert.equal(response.headers.get("access-control-allow-origin"), "*");
        assert.match(response.headers.get("access-control-allow-methods"), /POST/);
        assert.match(response.headers.get("access-control-allow-headers"), /Authorization/i);
    } finally {
        server.stop();
    }
});

test("the root path serves a plain-text info screen", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const response = await fetch(baseUrl);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /text\/plain/);
        const body = await response.text();
        assert.match(body, /Auth Server/);
        assert.match(body, /uptime\s+: \d/);
    } finally {
        server.stop();
    }
});

test("the JWKS endpoint publishes the signing key's public half", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const response = await fetch(`${baseUrl}/.well-known/jwks.json`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.keys.length, 1);
        assert.equal(body.keys[0].kty, "OKP");
        assert.equal(body.keys[0].crv, "Ed25519");
        assert.equal(typeof body.keys[0].x, "string");
        assert.equal(typeof body.keys[0].d, "undefined", "private scalar must never be published");
    } finally {
        server.stop();
    }
});

test("login creates an account and returns a session token", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const response = await fetch(`${baseUrl}/login`, {
            method: "POST",
            body: JSON.stringify({username: "alice"}),
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.accountId, 1);
        assert.equal(body.username, "alice");
        assert.equal(typeof body.sessionToken, "string");
        assert.equal(server.accountIdForSession(body.sessionToken), 1);
    } finally {
        server.stop();
    }
});

test("login is idempotent per username and mints a fresh token each time", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const first = await (await fetch(`${baseUrl}/login`, {method: "POST", body: JSON.stringify({username: "alice"})})).json();
        const second = await (await fetch(`${baseUrl}/login`, {method: "POST", body: JSON.stringify({username: "alice"})})).json();
        assert.equal(first.accountId, second.accountId);
        assert.notEqual(first.sessionToken, second.sessionToken);
    } finally {
        server.stop();
    }
});

test("an invalid username is rejected with 400", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const response = await fetch(`${baseUrl}/login`, {method: "POST", body: JSON.stringify({username: "ab"})});
        assert.equal(response.status, 400);
        assert.equal(server.accountIdForSession("anything"), null);
    } finally {
        server.stop();
    }
});

test("a malformed body is rejected with 400", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const response = await fetch(`${baseUrl}/login`, {method: "POST", body: "not json"});
        assert.equal(response.status, 400);
    } finally {
        server.stop();
    }
});

test("join mints a token for a bearer-authenticated session", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const sessionToken = await login(baseUrl, "alice");
        const response = await fetch(`${baseUrl}/join`, {
            method: "POST",
            headers: {authorization: `Bearer ${sessionToken}`},
            body: JSON.stringify({origin: "wss://example.com:443"}),
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.token.split(".").length, 3);
    } finally {
        server.stop();
    }
});

test("join without a bearer token is rejected with 401", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const response = await fetch(`${baseUrl}/join`, {
            method: "POST",
            body: JSON.stringify({origin: "wss://example.com:443"}),
        });
        assert.equal(response.status, 401);
    } finally {
        server.stop();
    }
});

test("join with a malformed origin is rejected with 400", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const sessionToken = await login(baseUrl, "alice");
        const response = await fetch(`${baseUrl}/join`, {
            method: "POST",
            headers: {authorization: `Bearer ${sessionToken}`},
            body: JSON.stringify({origin: "not-an-origin"}),
        });
        assert.equal(response.status, 400);
    } finally {
        server.stop();
    }
});

test("a malformed body is rejected with 400 on join and rejoin too", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const sessionToken = await login(baseUrl, "alice");
        const join = await fetch(`${baseUrl}/join`, {
            method: "POST",
            headers: {authorization: `Bearer ${sessionToken}`},
            body: "not json",
        });
        assert.equal(join.status, 400);
        assert.equal(await join.text(), "Malformed JSON body");
        const rejoin = await fetch(`${baseUrl}/rejoin`, {method: "POST", body: "not json"});
        assert.equal(rejoin.status, 400);
        assert.equal(await rejoin.text(), "Malformed JSON body");
    } finally {
        server.stop();
    }
});

test("a malformed server list is served as empty rather than killing the process", async () => {
    const serversPath = join(mkdtempSync(join(tmpdir(), "authserver-servers-")), "servers.json");
    writeFileSync(serversPath, "{ not json");
    const {server, baseUrl} = await startServer(serversPath);
    try {
        const sessionToken = await login(baseUrl, "alice");
        const headers = {authorization: `Bearer ${sessionToken}`};

        const response = await fetch(`${baseUrl}/servers`, {headers});
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {servers: []});

        const again = await fetch(`${baseUrl}/servers`, {headers});
        assert.equal(again.status, 200, "the server is still up");
    } finally {
        server.stop();
    }
});

test("join on a session whose account is gone is rejected with 401", async () => {
    const {server, store, baseUrl} = await startServer();
    try {
        const sessionToken = await login(baseUrl, "alice");
        store.db.exec("DELETE FROM \"Account\"");

        const response = await fetch(`${baseUrl}/join`, {
            method: "POST",
            headers: {authorization: `Bearer ${sessionToken}`},
            body: JSON.stringify({origin: "wss://example.com:443"}),
        });

        assert.equal(response.status, 401);
    } finally {
        server.stop();
    }
});

test("an account's oldest session is dropped once it is past the per-account cap", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const tokens = [];
        for (let i = 0; i <= MAX_SESSIONS_PER_ACCOUNT; i++) {
            tokens.push(await login(baseUrl, "alice"));
        }

        assert.equal(server.accountIdForSession(tokens[0]), null, "the oldest session is evicted");
        assert.notEqual(server.accountIdForSession(tokens[1]), null, "the next oldest survives");
        assert.notEqual(server.accountIdForSession(tokens[tokens.length - 1]), null, "the newest survives");
    } finally {
        server.stop();
    }
});

test("a session for another account is untouched by one account hitting the cap", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const bob = await login(baseUrl, "bob");
        for (let i = 0; i <= MAX_SESSIONS_PER_ACCOUNT; i++) {
            await login(baseUrl, "alice");
        }

        assert.notEqual(server.accountIdForSession(bob), null);
    } finally {
        server.stop();
    }
});
