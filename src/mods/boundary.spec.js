// The SDK boundary, enforced mechanically: a mod may only reach the engine through @spup/sdk, so
// every mod is buildable as a standalone package (see docs/mod-distribution.md).

import {test} from "node:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import {join, dirname, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const MODS_DIR = dirname(fileURLToPath(import.meta.url));

// The two SDK entries, plus the test harness a spec additionally binds to.
const SDK_SPECIFIERS = ["@spup/sdk", "@spup/sdk/client"];
const TEST_PREFIX = "@/test/";
const MOD_PREFIX = "@/mods/";
const NODE_PREFIX = "node:";

// `import x from "y"` / `export {x} from "y"`, bare `import "y"`, and dynamic `import("y")`.
const FROM_PATTERN = /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*"([^"]+)"/g;
const BARE_IMPORT_PATTERN = /(?:^|\n)\s*import\s*"([^"]+)"/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*"([^"]+)"\s*\)/g;

/**
 * Every .js file inside `dir`, recursively.
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
function jsFilesIn(dir) {
    const found = [];
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...jsFilesIn(path));
        } else if (entry.name.endsWith(".js")) {
            found.push(path);
        }
    }
    return found;
}

/**
 * The specifiers a source file imports, however it spells the import.
 * @param {string} source
 * @returns {string[]}
 */
function importSpecifiers(source) {
    const specifiers = [];
    for (const pattern of [FROM_PATTERN, BARE_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
        for (const match of source.matchAll(pattern)) {
            specifiers.push(match[1]);
        }
    }
    return specifiers;
}

/**
 * Why this import breaks the boundary, or null when it is allowed.
 * @param {string} specifier
 * @param {string} file absolute path of the importing file
 * @param {string} modName the mod that owns the file
 * @returns {string|null}
 */
function violation(specifier, file, modName) {
    const isSpec = file.endsWith(".spec.js");
    if (SDK_SPECIFIERS.includes(specifier)) {
        return null;
    }
    if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier);
        const modDir = join(MODS_DIR, modName);
        if (target.startsWith(modDir + sep)) {
            return null;
        }
        return `relative import escapes the mod directory (resolves to ${relative(MODS_DIR, target)})`;
    }
    if (specifier.startsWith(MOD_PREFIX)) {
        if (specifier.startsWith(`${MOD_PREFIX}${modName}/`)) {
            // The builder resolves no aliases at all, so a mod's own files must be reached
            // relatively — that is what lets a mod build outside this repo.
            return "reaches its own files through the @/ alias; use a relative path";
        }
        return "imports another mod; mods share code only through the SDK";
    }
    if (specifier.startsWith(TEST_PREFIX) || specifier.startsWith(NODE_PREFIX)) {
        if (isSpec) {
            return null;
        }
        return "the test harness is available to .spec.js files only";
    }
    return "not part of the mod SDK; widen src/sdk/common.js or src/sdk/client.js instead";
}

test("mods import nothing but the SDK", () => {
    const modNames = readdirSync(MODS_DIR, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    assert.ok(modNames.length > 0, "no mods found to check");

    const failures = [];
    for (const modName of modNames) {
        for (const file of jsFilesIn(join(MODS_DIR, modName))) {
            const source = readFileSync(file, "utf8");
            for (const specifier of importSpecifiers(source)) {
                const reason = violation(specifier, file, modName);
                if (reason !== null) {
                    failures.push(`${relative(MODS_DIR, file)}: "${specifier}" — ${reason}`);
                }
            }
        }
    }
    assert.deepEqual(failures, [], `SDK boundary violations:\n${failures.join("\n")}`);
});
