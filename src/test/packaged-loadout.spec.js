// The server path a packaged loadout takes: build -> pin -> cache -> load -> serve. Uses file: URLs
// so the whole round trip runs without a network.

import {test, after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {ModRegistry} from "@/common/ModRegistry.js";
import {formatIntegrity, integrityHex, contentName} from "@/common/ModIntegrity.js";
import {SDK_VERSION} from "@/common/ModManifest.js";
import {ModLockfile} from "@/common/ModLockfile.js";
import {ModCache, resolvePackage, sha256Hex} from "@/server/ModCache.js";
import {loadPackagedMods} from "@/server/ModLoader.js";
import {externalModList, modListJson} from "@/server/modList.js";
import {simLoadout, MOD_DIRS} from "@/mods/loadout.js";
import {modName} from "@/mods/modNames.js";
import {buildMod} from "../../tools/build-mod.js";

// Bundling every mod is this file's expensive step, so one build serves every test over it; each
// test re-pins those same packages, since a lockfile is mutable state a test may tamper with.
const packageRoot = mkdtempSync(join(tmpdir(), "pipes-packages-"));
after(() => rmSync(packageRoot, {recursive: true, force: true}));
const packageUrls = [];
for (const dir of MOD_DIRS) {
    const outDir = join(packageRoot, dir);
    await buildMod(resolve("src/mods", dir), outDir, {version: "1.0.0"});
    packageUrls.push(pathToFileURL(outDir).href);
}

/**
 * The built packages as a fresh lockfile, in loadout order.
 * @returns {Promise<ModLockfile>}
 */
async function lockfileFor() {
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
    const lockfile = await lockfileFor();
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
    assert.deepEqual(mods.map(mod => mod.manifest.name), MOD_DIRS.map(dir => modName(dir)));
});

test("the served list says where each mod came from and what its bundle must hash to", async (t) => {
    const root = tempRoot(t);
    const lockfile = await lockfileFor();
    const cache = new ModCache(join(root, "cache"));
    await cache.populate(lockfile);
    const {mods} = await loadPackagedMods(lockfile, cache);

    const list = JSON.parse(modListJson(externalModList(mods)));

    assert.equal(list.sdkVersion, SDK_VERSION);
    assert.deepEqual(list.mods.map(mod => mod.name), lockfile.mods.map(entry => entry.name));
    for (const mod of list.mods) {
        // The client downloads the bundle from that URL and checks it against this hash, so the two
        // have to describe the same bytes.
        assert.equal(mod.url, lockfile.find(mod.name).url);
        assert.equal(formatIntegrity(sha256Hex(cache.read(contentName(integrityHex(mod.integrity), "mod.js")))), mod.integrity);
    }
    assert.ok(list.mods.find(mod => mod.name === "market").parts.includes("sim"));
    assert.ok(list.mods.find(mod => mod.name === "logistics").parts.includes("client"));
});

test("a tampered file fails the hash check instead of loading", async (t) => {
    const root = tempRoot(t);
    const lockfile = await lockfileFor();
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
    const lockfile = await lockfileFor();
    const entry = lockfile.find("fluids");
    entry.integrity.set("mod.js", formatIntegrity("0".repeat(64)));

    const cache = new ModCache(join(root, "cache"));
    await assert.rejects(() => cache.populate(lockfile), /pins sha256-0{64}/);
});

test("a pinned loadout round-trips through JSON", async () => {
    const lockfile = await lockfileFor();
    assert.deepEqual(ModLockfile.parse(lockfile.toJSON()).toJSON(), lockfile.toJSON());
    assert.throws(() => ModLockfile.parse({mods: [{name: "x"}]}), /must end in/);
});
