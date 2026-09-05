import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {World} from "@/server/World.js";
import {ServerConfig} from "@/common/ServerConfig.js";
import {MOD_DIRS} from "@/mods/modDirs.js";

/**
 * @param {object} t
 * @returns {string}
 */
function tempDir(t) {
    const dir = mkdtempSync(join(tmpdir(), "spup-world-"));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    return dir;
}

/**
 * @param {string} dir
 * @param {object} [extra]
 * @returns {ServerConfig}
 */
function configIn(dir, extra = {}) {
    return ServerConfig.parse(Object.assign({db: join(dir, "world.sqlite3"), metricsDb: join(dir, "metrics.sqlite3")}, extra));
}

test("a fresh world boots on the built-in loadout, saves on close, and loads back with its seed", async (t) => {
    const dir = tempDir(t);
    const first = await World.boot(configIn(dir, {seed: 7}));
    assert.equal(first.loaded, false);
    assert.equal(first.game.seed, 7);
    assert.deepEqual(JSON.parse(first.modListJson).mods.map(mod => mod.name), MOD_DIRS);
    assert.deepEqual(first.lockfile.mods, []);
    await first.close();

    const second = await World.boot(configIn(dir));
    assert.equal(second.loaded, true);
    assert.equal(second.game.seed, 7);
    await second.close();
});

test("a seed that differs from the saved world's is refused", async (t) => {
    const dir = tempDir(t);
    await (await World.boot(configIn(dir, {seed: 7}))).close();
    await assert.rejects(World.boot(configIn(dir, {seed: 8})), /seed/);
});

test("a discarded world saves nothing, and with its files deleted the next boot starts fresh", async (t) => {
    const dir = tempDir(t);
    const config = configIn(dir, {seed: 7});
    await (await World.boot(config)).close();
    const world = await World.boot(config);
    assert.equal(world.loaded, true);
    await world.discard();
    World.deleteFiles(config);

    const fresh = await World.boot(configIn(dir, {seed: 9}));
    assert.equal(fresh.loaded, false);
    assert.equal(fresh.game.seed, 9);
    await fresh.close();
});

test("deleting the files of a world that never saved is not an error", (t) => {
    World.deleteFiles(configIn(tempDir(t)));
});
