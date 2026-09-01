// The operator CLI is a script, not a module, so it is exercised the way an operator runs it.

import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {readLockfileOrEmpty} from "@/server/modLockfileFile.js";

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
    writeFileSync(path, JSON.stringify(PINNED));
}

test("list reports an absent lockfile as pinning nothing", (t) => {
    const path = join(tempDir(t), "mods.json");
    assert.match(runCli(["list", "--mods", path]), /pins no mods/);
});

test("list prints every pinned mod", (t) => {
    const path = join(tempDir(t), "mods.json");
    writePinned(path);
    assert.match(runCli(["list", "--mods", path]), /0\. logistics 2\.1\.0 {2}https:\/\/mods\.example\/logistics\/2\.1\.0\//);
});

test("readLockfileOrEmpty reads a written lockfile", (t) => {
    const path = join(tempDir(t), "mods.json");
    writePinned(path);
    assert.equal(readLockfileOrEmpty(path).mods.length, 1);
});
