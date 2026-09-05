import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {readdirSync} from "node:fs";
import {MOD_DIRS, MOD_ROOTS, MODS_ROOT, dirsIn} from "@/mods/modDirs.js";

/**
 * @param {object} t the test context, for cleanup
 * @param {string[]} dirs each given a declaration.js
 * @returns {string} the root holding them
 */
function modsRoot(t, dirs) {
    const root = mkdtempSync(join(tmpdir(), "pipes-mod-dirs-"));
    t.after(() => rmSync(root, {recursive: true, force: true}));
    for (const dir of dirs) {
        mkdirSync(join(root, dir));
        writeFileSync(join(root, dir, "declaration.js"), "export class Declaration {}\n");
    }
    return root;
}

test("MOD_DIRS is every mod directory, in alphabetical order", () => {
    const dirs = readdirSync("src/mods", {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);

    assert.deepEqual(MOD_DIRS, dirs.sort());
    assert.equal(MOD_ROOTS.get(MOD_DIRS[0]), MODS_ROOT);
});

test("dirsIn sorts a root by name, so a numeric prefix places a mod", (t) => {
    const root = modsRoot(t, ["widgets", "10-first", "9-second"]);

    assert.deepEqual(dirsIn(root), ["10-first", "9-second", "widgets"]);
});

test("dirsIn ignores a directory that declares nothing, and a missing root", (t) => {
    const root = modsRoot(t, ["widgets"]);
    mkdirSync(join(root, "notes-to-self"));

    assert.deepEqual(dirsIn(root), ["widgets"]);
    assert.deepEqual(dirsIn(join(root, "nowhere")), []);
});
