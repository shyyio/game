// The server path a packaged loadout takes: build -> pin -> cache -> load -> serve. Uses file: URLs
// so the whole round trip runs without a network.

import {test, after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {ModRegistry} from "@/common/ModRegistry.js";
import {formatIntegrity} from "@/common/ModIntegrity.js";
import {SDK_VERSION} from "@/common/ModManifest.js";
import {ModLockfile} from "@/common/ModLockfile.js";
import {readLockfile, writeLockfile} from "@/server/modLockfileFile.js";
import {ModCache, resolvePackage, sha256Hex} from "@/server/ModCache.js";
import {loadPackagedMods} from "@/server/ModLoader.js";
import {ModHost} from "@/server/ModHost.js";
import {simLoadout, BASE_MOD_DIRS} from "@/mods/loadout.js";
import {buildMod} from "../../tools/build-mod.js";

// Bundling every mod is this file's expensive step, so one build serves every test over it; each
// test re-pins those same packages, since a lockfile is mutable state a test may tamper with.
const packageRoot = mkdtempSync(join(tmpdir(), "pipes-packages-"));
after(() => rmSync(packageRoot, {recursive: true, force: true}));
const packageUrls = [];
for (const dir of BASE_MOD_DIRS) {
    const outDir = join(packageRoot, dir);
    await buildMod(resolve("src/mods", dir), outDir, {version: "1.0.0"});
    packageUrls.push(pathToFileURL(outDir).href);
}

/**
 * Pins the built packages into a fresh lockfile, in loadout order.
 * @returns {Promise<ModLockfile>}
 */
async function pinLoadout() {
    const entries = [];
    for (const url of packageUrls) {
        entries.push(await resolvePackage(url));
    }
    return new ModLockfile(entries);
}

/**
 * @param {string} prefix
 * @param {object} t the test context, for cleanup
 * @returns {string}
 */
function tempRoot(t) {
    const root = mkdtempSync(join(tmpdir(), "pipes-loadout-"));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    return root;
}

test("a pinned loadout caches, loads, and registers like the static one", async (t) => {
    const root = tempRoot(t);
    const lockfile = await pinLoadout();
    const cache = new ModCache(join(root, "cache"));

    assert.equal(await cache.populate(lockfile), lockfile.mods.reduce((sum, entry) => sum + entry.integrity.size, 0));
    assert.deepEqual(cache.verify(lockfile), []);
    // A second populate is a no-op: every file is already cached under its hash.
    assert.equal(await cache.populate(lockfile), 0);

    const {packages, mods} = await loadPackagedMods(lockfile, cache);
    const registry = new ModRegistry();
    for (const pkg of packages) {
        registry.register(pkg);
    }
    registry.freeze();

    const staticRegistry = new ModRegistry();
    for (const pkg of simLoadout()) {
        staticRegistry.register(pkg);
    }
    staticRegistry.freeze();

    assert.deepEqual(
        registry.objectTypes.map(type => [type.name, type.typeId]),
        staticRegistry.objectTypes.map(type => [type.name, type.typeId]),
    );
    assert.deepEqual(mods.map(mod => mod.manifest.name), [
        "base-textures", "logistics", "base-game", "fluids", "cursor-sync", "market", "notes",
        "production-log",
    ]);
});

test("the served index names every file by its content hash", async (t) => {
    const root = tempRoot(t);
    const lockfile = await pinLoadout();
    const cache = new ModCache(join(root, "cache"));
    await cache.populate(lockfile);
    const {mods} = await loadPackagedMods(lockfile, cache);

    const index = JSON.parse(new ModHost(mods, cache).indexJson);

    assert.equal(index.sdkVersion, SDK_VERSION);
    assert.deepEqual(index.mods.map(mod => mod.name), lockfile.mods.map(entry => entry.name));
    for (const mod of index.mods) {
        // The name a bundle is served under is its own digest, so a client needs nothing else to
        // verify what it downloaded.
        assert.equal(sha256Hex(cache.read(mod.entry)), mod.entry.slice(0, 64));
    }
    assert.ok(index.mods.find(mod => mod.name === "market").parts.includes("sim"));
    assert.ok(index.mods.find(mod => mod.name === "logistics").parts.includes("client"));
});

test("a tampered file fails the hash check instead of loading", async (t) => {
    const root = tempRoot(t);
    const lockfile = await pinLoadout();
    const cache = new ModCache(join(root, "cache"));
    await cache.populate(lockfile);

    const entry = lockfile.find("base-game");
    const bundleName = `${entry.integrityOf("mod.js").slice("sha256-".length)}.js`;
    writeFileSync(cache.pathOf(bundleName), `${readFileSync(cache.pathOf(bundleName), "utf8")}\n// tampered\n`);

    assert.deepEqual(cache.verify(lockfile).length, 1);
    await assert.rejects(() => loadPackagedMods(lockfile, cache), /does not match its own hash/);
});

test("a package whose bytes drift from the pin refuses to cache", async (t) => {
    const root = tempRoot(t);
    const lockfile = await pinLoadout();
    const entry = lockfile.find("fluids");
    entry.integrity.set("mod.js", formatIntegrity("0".repeat(64)));

    const cache = new ModCache(join(root, "cache"));
    await assert.rejects(() => cache.populate(lockfile), /pins sha256-0{64}/);
});

test("mods.json round-trips through parse and write", async (t) => {
    const root = tempRoot(t);
    const lockfile = await pinLoadout();
    const path = join(root, "mods.json");
    writeLockfile(lockfile, path);

    assert.deepEqual(readLockfile(path).toJSON(), lockfile.toJSON());
    assert.throws(() => ModLockfile.parse({mods: [{name: "x"}]}), /must end in/);
});
