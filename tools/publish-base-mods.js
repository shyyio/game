// Builds every in-repo mod into packages, with an order.json naming them in loadout order. A server
// pins them from there with `mods sync-base --dist-mods <dir>`.
//
//   node tools/publish-base-mods.js --out build/mods [--version 1.0.0]

import {mkdirSync, writeFileSync} from "node:fs";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {buildMod} from "./build-mod.js";
import {GAME_VERSION} from "../src/common/constants.js";
import {dirsIn, MODS_ROOT} from "../src/mods/modDirs.js";
import {ORDER_FILE} from "../vite.build-defines.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODS_DIR = join(REPO_ROOT, MODS_ROOT);

/**
 * Builds the mods this game ships into outDir and writes its order.json. A checkout's own dev-mods
 * are not packaged: they belong to whoever is working on them.
 * @param {string} outDir
 * @param {string} version
 * @returns {Promise<string[]>} the built package directories' names, in loadout order
 */
export async function publishBaseMods(outDir, version) {
    const dirs = dirsIn(MODS_DIR);
    mkdirSync(outDir, {recursive: true});
    for (const dir of dirs) {
        const packageDir = join(outDir, dir);
        const manifest = await buildMod(join(MODS_DIR, dir), packageDir, {version});
        console.log(`  ${manifest.name} ${manifest.version} -> ${packageDir}`);
    }
    // Loadout order assigns the positional type and wire ids, so the built set carries it.
    writeFileSync(join(outDir, ORDER_FILE), `${JSON.stringify(dirs, null, 4)}\n`);
    return dirs;
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
