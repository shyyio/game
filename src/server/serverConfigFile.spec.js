import {test} from "node:test";
import assert from "node:assert/strict";
import {chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ServerConfig} from "@/common/ServerConfig.js";
import {generateAdminToken, readServerConfigOrDefault, resolveConfigPaths, writeServerConfig} from "@/server/serverConfigFile.js";

/**
 * @param {object} t
 * @returns {string}
 */
function tempDir(t) {
    const dir = mkdtempSync(join(tmpdir(), "spup-server-config-"));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    return dir;
}

test("a missing file reads as the defaults", (t) => {
    const config = readServerConfigOrDefault(join(tempDir(t), "server.json"));
    assert.equal(config.port, 27500);
});

test("a written config reads back, leaving no temporary file behind", (t) => {
    const dir = tempDir(t);
    const path = join(dir, "server.json");
    writeServerConfig(ServerConfig.parse({name: "Mine", port: 1}), path);
    assert.equal(readServerConfigOrDefault(path).name, "Mine");
    assert.deepEqual(readdirSync(dir), ["server.json"]);
});

test("a file that does not parse throws rather than reading as defaults", (t) => {
    const path = join(tempDir(t), "server.json");
    writeFileSync(path, "{\"port\": \"x\"}");
    assert.throws(() => readServerConfigOrDefault(path), /port/);
});

test("a generated admin token is long, random hex", () => {
    const token = generateAdminToken();
    assert.match(token, /^[0-9a-f]{32}$/);
    assert.notEqual(token, generateAdminToken());
});

test("relative paths resolve against the config's directory, absolute ones stay", () => {
    const config = ServerConfig.parse({db: "world.sqlite3", metricsDb: "/var/lib/spup/metrics.sqlite3", modsCache: "cache/mods"});
    const resolved = resolveConfigPaths(config, "/srv/game");
    assert.equal(resolved.db, "/srv/game/world.sqlite3");
    assert.equal(resolved.metricsDb, "/var/lib/spup/metrics.sqlite3");
    assert.equal(resolved.modsCache, "/srv/game/cache/mods");
    assert.equal(config.db, "world.sqlite3");
});

const OWNER_ONLY = 0o600;
const MODE_MASK = 0o777;

test("a new config file is readable only by its owner, since it holds the admin token", (t) => {
    const path = join(tempDir(t), "server.json");
    writeServerConfig(ServerConfig.parse({name: "Mine"}), path);
    assert.equal(statSync(path).mode & MODE_MASK, OWNER_ONLY);
});

test("rewriting a config keeps the mode the operator set on it", (t) => {
    const path = join(tempDir(t), "server.json");
    writeServerConfig(ServerConfig.parse({name: "Mine"}), path);
    chmodSync(path, 0o640);
    writeServerConfig(ServerConfig.parse({name: "Renamed"}), path);
    assert.equal(statSync(path).mode & MODE_MASK, 0o640);
});
