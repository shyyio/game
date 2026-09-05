import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AbstractHttpServer} from "@/nodeservice/AbstractHttpServer.js";
import {AdminRoutes} from "@/server/AdminRoutes.js";
import {LoadoutChangeRefused} from "@/server/ServerRuntime.js";
import {ServerConfig} from "@/common/ServerConfig.js";
import {ModLockfile} from "@/common/ModLockfile.js";
import {ModCache} from "@/server/ModCache.js";
import {MOD_PART_DECLARATION, SDK_VERSION} from "@/common/ModManifest.js";
import {formatIntegrity} from "@/common/ModIntegrity.js";

const TOKEN = "secret-token";

/**
 * @param {string} content
 * @returns {string} "sha256-<hex>"
 */
function hashOf(content) {
    return formatIntegrity(createHash("sha256").update(content).digest("hex"));
}

/**
 * @param {object} t
 * @returns {string}
 */
function tempDir(t) {
    const dir = mkdtempSync(join(tmpdir(), "spup-admin-"));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    return dir;
}

/**
 * A built package directory, pinnable by file: URL.
 * @param {string} dir
 * @param {string} name
 * @param {string} version
 * @returns {object} its mods.json entry, as PUT /admin/api/mods takes it
 */
function writePackage(dir, name, version) {
    const packageDir = join(dir, name, version);
    mkdirSync(packageDir, {recursive: true});
    const manifest = JSON.stringify({
        name, version, sdkVersion: SDK_VERSION, title: name, entry: "mod.js", parts: [MOD_PART_DECLARATION],
    });
    const script = `// ${name}\n`;
    writeFileSync(join(packageDir, "mod.json"), manifest);
    writeFileSync(join(packageDir, "mod.js"), script);
    return {url: `file://${packageDir}/`, name, version, integrity: {"mod.json": hashOf(manifest), "mod.js": hashOf(script)}};
}

/**
 * The runtime as the routes see it: what runs, the world, and what applying does.
 */
class FakeRuntime {

    /**
     * @param {ServerConfig} running
     * @param {boolean} loaded
     * @param {object[]} mods the world's pins
     */
    constructor(running, loaded, mods) {
        this.running = running;
        this.world = {loaded, game: {seed: 7}, lockfile: ModLockfile.parse({mods})};
        this.applied = [];
        this.resets = [];
        this.failNext = "";
        this.losses = null;
        this.baseDir = "/srv/game";
    }

    /**
     * @param {ServerConfig} config
     * @returns {ServerConfig}
     */
    resolvePaths(config) {
        return config;
    }

    /**
     * @param {ServerConfig} config
     * @returns {Promise<string[]>}
     */
    async resetWorld(config) {
        this._maybeFail();
        this.resets.push(config);
        this.running = config;
        return [];
    }

    /**
     * @param {ServerConfig} config
     * @param {{convert: boolean}} [options]
     * @returns {Promise<string[]>}
     */
    async apply(config, {convert = false} = {}) {
        this._maybeFail();
        if (this.losses !== null && !convert) {
            throw new LoadoutChangeRefused(this.losses);
        }
        this.applied.push(config);
        const restart = config.port === this.running.port ? [] : ["port"];
        this.running = config;
        return restart;
    }

    /**
     * @private
     * @returns {void}
     */
    _maybeFail() {
        if (this.failNext !== "") {
            const message = this.failNext;
            this.failNext = "";
            throw new Error(message);
        }
    }
}

class TestServer extends AbstractHttpServer {

}

/**
 * @param {object} t
 * @param {object} [options]
 * @returns {Promise<{baseUrl: string, dir: string, runtime: FakeRuntime}>}
 */
async function startServer(t, {worldLoaded = false, mods = null} = {}) {
    const dir = tempDir(t);
    mkdirSync(join(dir, "admin"));
    writeFileSync(join(dir, "admin", "admin.html"), "<title>Admin</title>");
    writeFileSync(join(dir, "admin", "app.js"), "// app");
    let pinned = [];
    if (mods !== null) {
        pinned = mods;
    }
    const modsCache = join(dir, "mods-cache");
    const saved = ServerConfig.parse({name: "Saved", port: 1, mods, modsCache, adminToken: TOKEN});
    const runtime = new FakeRuntime(ServerConfig.parse({name: "Saved", port: 2, mods, modsCache, adminToken: TOKEN}), worldLoaded, pinned);
    const routes = new AdminRoutes({
        configPath: join(dir, "server.json"),
        saved,
        pinned: ["port"],
        runtime,
        adminDir: join(dir, "admin"),
    });
    const server = new TestServer();
    routes.registerRoutes(server.app);
    await server.listen("127.0.0.1", 0);
    t.after(() => server.stop());
    return {baseUrl: `http://127.0.0.1:${server.port}`, dir, runtime};
}

/**
 * @param {string} url
 * @param {object} [init]
 * @returns {Promise<Response>}
 */
function asAdmin(url, init = {}) {
    return fetch(url, Object.assign({headers: {Authorization: `Bearer ${TOKEN}`}}, init));
}

/**
 * @param {string} url
 * @param {object} body
 * @returns {Promise<Response>}
 */
function put(url, body) {
    return asAdmin(url, {method: "PUT", body: JSON.stringify(body)});
}

test("a malformed percent-escape under /admin is a 404, not a crash", async (t) => {
    const {baseUrl} = await startServer(t);
    assert.equal((await fetch(`${baseUrl}/admin/%`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/admin/%zz`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/admin`)).status, 200);
});

test("the api needs the admin token; the page does not", async (t) => {
    const {baseUrl} = await startServer(t);
    assert.equal((await fetch(`${baseUrl}/admin/api/state`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/admin/api/state`, {headers: {Authorization: "Bearer wrong"}})).status, 401);
    assert.equal((await asAdmin(`${baseUrl}/admin/api/state`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/admin`)).status, 200);
});

test("the state reports the saved and running configs without the token, the overridden fields, the world", async (t) => {
    const {baseUrl} = await startServer(t, {worldLoaded: true});
    const state = await (await asAdmin(`${baseUrl}/admin/api/state`)).json();
    assert.equal(state.saved.port, 1);
    assert.equal(state.running.port, 2);
    assert.equal(state.saved.adminToken, undefined);
    assert.equal(state.running.adminToken, undefined);
    assert.deepEqual(state.pinned, ["port"]);
    assert.deepEqual(state.world, {loaded: true, seed: 7});
    assert.equal(state.saved.mods, null);
    assert.equal(state.baseDir, "/srv/game");
});

test("saving a config applies it, keeps the token, and writes the file", async (t) => {
    const {baseUrl, dir, runtime} = await startServer(t);
    const response = await put(`${baseUrl}/admin/api/config`, {name: "Renamed", port: 2});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {restart: []});

    const moved = await put(`${baseUrl}/admin/api/config`, {name: "Renamed", port: 3});
    assert.deepEqual(await moved.json(), {restart: ["port"]}, "a new listen port waits for a restart");
    assert.equal(runtime.applied[0].name, "Renamed");
    assert.equal(runtime.applied[0].adminToken, TOKEN);
    const written = JSON.parse(readFileSync(join(dir, "server.json"), "utf8"));
    assert.equal(written.name, "Renamed");
    assert.equal(written.adminToken, TOKEN);
    const state = await (await asAdmin(`${baseUrl}/admin/api/state`)).json();
    assert.equal(state.saved.name, "Renamed");
    assert.equal(state.running.name, "Renamed");
});

test("a config that does not parse or apply is refused with its reason, and nothing is written", async (t) => {
    const {baseUrl, runtime} = await startServer(t);
    const bad = await put(`${baseUrl}/admin/api/config`, {port: "x"});
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /port/);
    runtime.failNext = "world.sqlite3 is incompatible";
    const failed = await put(`${baseUrl}/admin/api/config`, {db: "other.sqlite3"});
    assert.equal(failed.status, 400);
    assert.match(await failed.text(), /incompatible/);
    assert.equal((await (await asAdmin(`${baseUrl}/admin/api/state`)).json()).saved.port, 1);
});

test("a loaded world keeps its seed", async (t) => {
    const {baseUrl} = await startServer(t, {worldLoaded: true});
    const response = await put(`${baseUrl}/admin/api/config`, {seed: 8});
    assert.equal(response.status, 400);
    assert.match(await response.text(), /seed/);
    assert.equal((await put(`${baseUrl}/admin/api/config`, {seed: 7})).status, 200);
});

test("saving pinned mods fills the cache before the config applies and is written", async (t) => {
    const {baseUrl, dir, runtime} = await startServer(t);
    const entry = writePackage(join(dir, "packages"), "widgets", "1.0.0");
    const response = await put(`${baseUrl}/admin/api/config`, {mods: [entry], modsCache: join(dir, "mods-cache")});
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(runtime.applied[0].lockfile.mods.map(mod => mod.name), ["widgets"]);
    assert.equal(new ModCache(join(dir, "mods-cache")).verify(runtime.applied[0].lockfile).length, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "server.json"), "utf8")).mods.map(mod => mod.name), ["widgets"]);
});

test("a mod change that would lose something comes back as the losses until confirmed", async (t) => {
    const {baseUrl, dir, runtime} = await startServer(t, {worldLoaded: true});
    runtime.losses = {objects: [{name: "Gadget", count: 2}], items: [{name: "Gold", count: 3}]};
    const entry = writePackage(join(dir, "packages"), "widgets", "1.0.0");
    const refused = await put(`${baseUrl}/admin/api/config`, {mods: [entry]});
    assert.equal(refused.status, 409);
    assert.deepEqual(await refused.json(), {losses: runtime.losses});
    assert.deepEqual(runtime.applied, []);
    assert.equal(existsSync(join(dir, "server.json")), false);

    const converted = await asAdmin(`${baseUrl}/admin/api/config?convert=1`, {method: "PUT", body: JSON.stringify({mods: [entry]})});
    assert.equal(converted.status, 200);
    assert.equal(runtime.applied.length, 1);
    assert.equal(existsSync(join(dir, "server.json")), true);
});

test("a mod whose files do not hash as pinned is refused before anything applies", async (t) => {
    const {baseUrl, dir, runtime} = await startServer(t);
    const entry = writePackage(join(dir, "packages"), "widgets", "1.0.0");
    entry.integrity = {"mod.json": `sha256-${"00".repeat(32)}`};
    const response = await put(`${baseUrl}/admin/api/config`, {mods: [entry], modsCache: join(dir, "mods-cache")});
    assert.equal(response.status, 400);
    assert.match(await response.text(), /hashes to/);
    assert.deepEqual(runtime.applied, []);
});

test("the page and its assets are served under /admin, nothing else", async (t) => {
    const {baseUrl} = await startServer(t);
    for (const path of ["/admin", "/admin/"]) {
        const page = await fetch(`${baseUrl}${path}`);
        assert.match(page.headers.get("content-type"), /text\/html/);
        assert.match(await page.text(), /Admin/);
    }
    const script = await fetch(`${baseUrl}/admin/app.js`);
    assert.match(script.headers.get("content-type"), /javascript/);
    assert.equal((await fetch(`${baseUrl}/admin/missing.js`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/admin/..%2Fserver.json`)).status, 404);
});

test("a reset needs the token, takes the whole config, and writes it once the world is fresh", async (t) => {
    const {baseUrl, dir, runtime} = await startServer(t, {worldLoaded: true});
    assert.equal((await fetch(`${baseUrl}/admin/api/reset`, {method: "POST", body: "{}"})).status, 401);
    const response = await asAdmin(`${baseUrl}/admin/api/reset`, {method: "POST", body: JSON.stringify({seed: 9, name: "Fresh"})});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {restart: []});
    assert.equal(runtime.resets.length, 1);
    assert.equal(runtime.resets[0].seed, 9);
    assert.equal(runtime.resets[0].adminToken, TOKEN);
    assert.equal(JSON.parse(readFileSync(join(dir, "server.json"), "utf8")).name, "Fresh");
});

test("a reset that fails reports why and writes nothing", async (t) => {
    const {baseUrl, dir, runtime} = await startServer(t);
    runtime.failNext = "other.sqlite3 is not writable";
    const response = await asAdmin(`${baseUrl}/admin/api/reset`, {method: "POST", body: JSON.stringify({db: "other.sqlite3"})});
    assert.equal(response.status, 400);
    assert.match(await response.text(), /not writable/);
    assert.equal(existsSync(join(dir, "server.json")), false);
});
