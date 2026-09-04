// Builds every in-repo mod into packages, with an order.json naming them in loadout order. A server
// pins them from there with `mods sync-base --dist-mods <dir>`.
//
//   node tools/publish-base-mods.js --out build/mods [--version 1.0.0]

import {mkdirSync, readdirSync, writeFileSync} from "node:fs";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {buildMod} from "./build-mod.js";
import {GAME_VERSION} from "../src/common/constants.js";
import {BASE_MOD_DIRS} from "../src/mods/loadout.js";
import {ORDER_FILE} from "../vite.build-defines.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODS_DIR = join(REPO_ROOT, "src/mods");

/**
 * Builds the whole loadout into outDir and writes its order.json.
 * @param {string} outDir
 * @param {string} version
 * @returns {Promise<string[]>} the built package directories' names, in loadout order
 */
export async function publishBaseMods(outDir, version) {
    const known = readdirSync(MODS_DIR, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    const missing = known.filter(name => !BASE_MOD_DIRS.includes(name));
    if (missing.length > 0) {
        throw new Error(`src/mods has ${missing.join(", ")}, which src/mods/loadout.js's BASE_MOD_DIRS does not list`);
    }
    mkdirSync(outDir, {recursive: true});
    for (const dir of BASE_MOD_DIRS) {
        const packageDir = join(outDir, dir);
        const manifest = await buildMod(join(MODS_DIR, dir), packageDir, {version});
        console.log(`  ${manifest.name} ${manifest.version} -> ${packageDir}`);
    }
    // Loadout order assigns the positional type and wire ids, so the built set carries it.
    writeFileSync(join(outDir, ORDER_FILE), `${JSON.stringify(BASE_MOD_DIRS, null, 4)}\n`);
    return BASE_MOD_DIRS;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const {values: args} = parseArgs({
        options: {
            "out": {type: "string", default: join(REPO_ROOT, "build/mods")},
            "version": {type: "string", default: GAME_VERSION},
        },
    });
    const outDir = resolve(args.out);
    const built = await publishBaseMods(outDir, args.version);
    console.log(`${outDir}: ${built.length} base mods built`);
}
