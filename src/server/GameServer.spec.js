import {test} from "node:test";
import assert from "node:assert/strict";
import {GameServer} from "@/server/GameServer.js";
import {GameAPI} from "@/sim/GameAPI.js";
import {World} from "@/server/World.js";
import {ModLockfile} from "@/common/ModLockfile.js";
import {makeGame} from "@/test/ecsSim.js";
import {REGION_SIZE} from "@/common/constants.js";

const ORIGIN = "ws://127.0.0.1:27500";

/**
 * @param {object|null} [modHost]
 * @returns {Promise<World>} a fresh world over an in-memory game
 */
async function makeWorld(modListJson = "{\"mods\": []}") {
    const game = await makeGame();
    return new World({game, api: new GameAPI(game), modListJson, lockfile: new ModLockfile([]), loaded: false});
}

/**
 * @returns {Promise<{server: GameServer, baseUrl: string}>}
 */
async function startServer() {
    // The verifier is only reached by a sign-in frame, which no HTTP test sends.
    const server = new GameServer({}, ORIGIN, "Test Server");
    server.setWorld(await makeWorld());
    await server.listen("127.0.0.1", 0);
    return {server, baseUrl: `http://127.0.0.1:${server.port}`};
}

test("the mod list route serves whatever world is current", async () => {
    const {server, baseUrl} = await startServer();
    try {
        assert.deepEqual(await (await fetch(`${baseUrl}/mods/index.json`)).json(), {mods: []});
        const world = await makeWorld("{\"mods\": [{\"name\": \"widgets\"}]}");
        server.setWorld(world);
        assert.equal(server.world, world);
        assert.deepEqual(await (await fetch(`${baseUrl}/mods/index.json`)).json(), {mods: [{name: "widgets"}]});
    } finally {
        server.stop();
    }
});

test("a renamed server reports its new name", async () => {
    const {server, baseUrl} = await startServer();
    try {
        server.setName("Renamed");
        assert.equal((await (await fetch(`${baseUrl}/status`)).json()).name, "Renamed");
    } finally {
        server.stop();
    }
});

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
