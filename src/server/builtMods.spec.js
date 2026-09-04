import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pinBuiltMods} from "@/server/builtMods.js";
import {MOD_PART_DECLARATION, SDK_VERSION} from "@/common/ModManifest.js";

/**
 * @param {object} t
 * @returns {string}
 */
function tempDir(t) {
    const dir = mkdtempSync(join(tmpdir(), "spup-built-mods-"));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    return dir;
}

/**
 * @param {string} dir
 * @param {Array<{name: string, version: string}>} mods
 * @returns {void}
 */
function writeDistMods(dir, mods) {
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "order.json"), JSON.stringify(mods.map(mod => mod.name)));
    for (const mod of mods) {
        mkdirSync(join(dir, mod.name));
        writeFileSync(join(dir, mod.name, "mod.json"), JSON.stringify({
            name: mod.name, version: mod.version, sdkVersion: SDK_VERSION, title: mod.name, entry: "mod.js",
            parts: [MOD_PART_DECLARATION],
        }));
        writeFileSync(join(dir, mod.name, "mod.js"), `// ${mod.name}\n`);
    }
}

test("the built mods are pinned by file URL in the order the build lists them", async (t) => {
    const dir = join(tempDir(t), "dist-mods");
    writeDistMods(dir, [{name: "base-game", version: "1.0.0"}, {name: "fluids", version: "1.0.0"}]);
    const pinned = await pinBuiltMods(dir);
    assert.deepEqual(pinned.mods.map(mod => mod.name), ["base-game", "fluids"]);
    assert.match(pinned.mods[0].url, /^file:\/\/.*\/dist-mods\/base-game\/$/);
    assert.ok(pinned.mods[0].integrity.has("mod.js"));
});

test("a directory that holds no build reads as nothing built", async (t) => {
    assert.equal(await pinBuiltMods(join(tempDir(t), "nowhere")), null);
});
