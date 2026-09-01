import {test} from "node:test";
import assert from "node:assert/strict";
import {GameServer} from "@/server/GameServer.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {makeGame} from "@/test/ecsSim.js";
import {REGION_SIZE} from "@/common/constants.js";

const ORIGIN = "ws://127.0.0.1:27500";

/**
 * @returns {Promise<{server: GameServer, baseUrl: string}>}
 */
async function startServer() {
    const game = await makeGame();
    // The verifier is only reached by a sign-in frame, which no HTTP test sends.
    const server = new GameServer(game, new GameAPI(game), {}, ORIGIN, "Test Server");
    await server.listen("127.0.0.1", 0);
    return {server, baseUrl: `http://127.0.0.1:${server.port}`};
}

test("the bound port is readable after listening on port 0", async () => {
    const {server, baseUrl} = await startServer();
    try {
        assert.ok(server.port > 0);
        assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
        server.stop();
    }
});

test("the status endpoint reports the world's chunk counts, CORS-open", async () => {
    const {server, baseUrl} = await startServer();
    try {
        const response = await fetch(`${baseUrl}/status`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("access-control-allow-origin"), "*");
        const body = await response.json();
        assert.equal(body.name, "Test Server");
        assert.equal(body.online, 0);
        assert.equal(body.chunksClaimed + body.chunksAvailable, REGION_SIZE * REGION_SIZE);
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
        assert.match(body, /Game Server/);
        assert.match(body, /uptime\s+: \d/);
    } finally {
        server.stop();
    }
});
