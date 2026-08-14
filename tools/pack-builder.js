// Assembles packages/mod-builder/lib/ from this repo's own sources, so the published toolchain is
// the same code the game builds its mods with — not a copy that drifts.
//
//   node tools/pack-builder.js [--check]
//
// --check only verifies that an assembled lib/ is current, for a test to assert.

import {copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync} from "node:fs";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {SDK_VERSION} from "../src/common/ModManifest.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR = join(ROOT, "packages/mod-builder");
const LIB_DIR = join(PACKAGE_DIR, "lib");

// Source file -> what it becomes in lib/, with the imports it needs rewritten to lib-relative ones.
const VENDORED = [
    {from: "src/common/ModManifest.js", to: "ModManifest.js", rewrites: []},
    {from: "tools/mod-scan.js", to: "mod-scan.js", rewrites: []},
    {
        from: "tools/build-mod.js",
        to: "build-mod.js",
        rewrites: [["../src/common/ModManifest.js", "./ModManifest.js"]],
    },
];

/**
 * The lib/ contents this repo's sources imply.
 * @returns {Map<string, string>} file name -> source
 */
function assemble() {
    const files = new Map();
    for (const entry of VENDORED) {
        let source = readFileSync(join(ROOT, entry.from), "utf8");
        for (const [before, after] of entry.rewrites) {
            if (!source.includes(before)) {
                throw new Error(`${entry.from} no longer imports ${before}; fix the rewrite list`);
            }
            source = source.replaceAll(before, after);
        }
        files.set(entry.to, `// Vendored from ${entry.from} by tools/pack-builder.js — do not edit.\n${source}`);
    }
    return files;
}

/**
 * @returns {string[]} the files whose assembled content differs from what is on disk
 */
export function staleFiles() {
    const stale = [];
    for (const [name, source] of assemble()) {
        const path = join(LIB_DIR, name);
        if (!existsSync(path) || readFileSync(path, "utf8") !== source) {
            stale.push(name);
        }
    }
    return stale;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const {values: args} = parseArgs({options: {"check": {type: "boolean", default: false}}});
    if (args.check) {
        const stale = staleFiles();
        if (stale.length > 0) {
            console.error(`packages/mod-builder/lib is stale: ${stale.join(", ")}`);
            console.error("run `npm run pack:builder`");
            process.exitCode = 1;
        } else {
            console.log("packages/mod-builder/lib is current");
        }
    } else {
        rmSync(LIB_DIR, {recursive: true, force: true});
        mkdirSync(LIB_DIR, {recursive: true});
        for (const [name, source] of assemble()) {
            writeFileSync(join(LIB_DIR, name), source);
        }
        // Written by hand, not vendored: it has no counterpart in the game, which never stubs its
        // own SDK.
        copyFileSync(join(PACKAGE_DIR, "stubSdk.js"), join(LIB_DIR, "stubSdk.js"));
        console.log(`packages/mod-builder/lib: ${[...assemble().keys()].length + 1} files, SDK version ${SDK_VERSION}`);
    }
}
