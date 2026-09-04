// The operator CLI is a script, not a module, so it is exercised the way an operator runs it.

import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {readServerConfigOrDefault} from "@/server/serverConfigFile.js";
import {MOD_PART_DECLARATION, SDK_VERSION} from "@/common/ModManifest.js";

const CLI = resolve("src/server/modsCli.js");
const LOADER = resolve("src/nodeservice/loader.js");

const PINNED = {
    mods: [{
        name: "logistics",
        version: "2.1.0",
        url: "https://mods.example/logistics/2.1.0/",
        integrity: {"mod.json": `sha256-${"a1".repeat(32)}`},
    }],
};

/**
 * @param {object} t the test context, for cleanup
 * @returns {string}
 */
function tempDir(t) {
    const dir = mkdtempSync(join(tmpdir(), "spup-mods-cli-"));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    return dir;
}

/**
 * @param {string[]} args
 * @returns {string} stdout
 */
function runCli(args) {
    return execFileSync("node", ["--import", LOADER, CLI, ...args], {encoding: "utf8"});
}

/**
 * @param {string} path
 * @returns {void}
 */
function writePinned(path) {
    writeFileSync(path, JSON.stringify({name: "Mine", mods: PINNED.mods}));
}

test("list reports a config without pins as pinning nothing", (t) => {
    const path = join(tempDir(t), "server.json");
    assert.match(runCli(["list", "--config", path]), /pins no mods/);
});

test("list prints every pinned mod", (t) => {
    const path = join(tempDir(t), "server.json");
    writePinned(path);
    assert.match(runCli(["list", "--config", path]), /0\. logistics 2\.1\.0 {2}https:\/\/mods\.example\/logistics\/2\.1\.0\//);
});

/**
 * A built base-mod directory the way publish-base-mods.js lays it out: order.json plus one package
 * directory per mod.
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
            name: mod.name,
            version: mod.version,
            sdkVersion: SDK_VERSION,
            title: mod.name,
            entry: "mod.js",
            parts: [MOD_PART_DECLARATION],
        }));
        writeFileSync(join(dir, mod.name, "mod.js"), `// ${mod.name} ${mod.version}\n`);
    }
}

test("sync-base pins every built base mod into a config that pins nothing yet", (t) => {
    const dir = tempDir(t);
    const path = join(dir, "server.json");
    writeFileSync(path, JSON.stringify({name: "Mine"}));
    writeDistMods(join(dir, "dist-mods"), [{name: "base-game", version: "1.0.0"}, {name: "fluids", version: "1.0.0"}]);
    runCli(["sync-base", "--dist-mods", join(dir, "dist-mods"), "--config", path]);
    const config = readServerConfigOrDefault(path);
    assert.equal(config.name, "Mine");
    assert.deepEqual(config.lockfile.mods.map(mod => mod.name), ["base-game", "fluids"]);
    assert.match(config.lockfile.mods[0].url, /^file:\/\/.*\/dist-mods\/base-game\/$/);
});

test("sync-base re-pins built base mods in place and keeps the operator's other mods", (t) => {
    const dir = tempDir(t);
    const path = join(dir, "server.json");
    writeFileSync(path, JSON.stringify({mods: [
        {name: "base-game", version: "1.0.0", url: "file:///old/base-game/", integrity: {"mod.json": `sha256-${"a1".repeat(32)}`}},
        PINNED.mods[0],
    ]}));
    writeDistMods(join(dir, "dist-mods"), [{name: "base-game", version: "1.1.0"}, {name: "fluids", version: "1.1.0"}]);
    runCli(["sync-base", "--dist-mods", join(dir, "dist-mods"), "--config", path]);
    const pinned = readServerConfigOrDefault(path).lockfile;
    assert.deepEqual(
        pinned.mods.map(mod => `${mod.name} ${mod.version}`),
        ["base-game 1.1.0", "logistics 2.1.0", "fluids 1.1.0"],
    );
});

test("add is not a verb: the admin page pins mods", (t) => {
    const path = join(tempDir(t), "server.json");
    writePinned(path);
    assert.throws(
        () => runCli(["add", "https://mods.example/widgets/1.0.0/", "--config", path]),
        error => /usage:/.test(error.stderr) && !/mods add/.test(error.stderr),
    );
    assert.deepEqual(readServerConfigOrDefault(path).lockfile.mods.map(mod => mod.version), ["2.1.0"]);
});

test("update is not a verb: the admin page re-pins mods", (t) => {
    const path = join(tempDir(t), "server.json");
    writePinned(path);
    assert.throws(
        () => runCli(["update", "logistics", "--config", path]),
        error => /usage:/.test(error.stderr) && !/mods update/.test(error.stderr),
    );
    assert.deepEqual(readServerConfigOrDefault(path).lockfile.mods.map(mod => mod.version), ["2.1.0"]);
});

test("verify reads the mod cache relative to the config, not the working directory", (t) => {
    const dir = tempDir(t);
    const path = join(dir, "server.json");
    writeFileSync(path, JSON.stringify({modsCache: "mods-cache"}));
    const out = execFileSync("node", ["--import", LOADER, CLI, "verify", "--config", path], {encoding: "utf8", cwd: tmpdir()});
    assert.match(out, new RegExp(join(dir, "mods-cache")));
});
