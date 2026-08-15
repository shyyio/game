// Builds every in-repo mod into packages and writes the lockfile a server boots from. This is how
// the official servers run their own mods before the registry exists — and how any operator can
// dogfood the packaged path from a source checkout.
//
//   node tools/publish-base-mods.js --out dist-mods --lockfile mods.json [--version 1.0.0]
//
// The lockfile pins the built directories by file: URL, so the server's cache fills from disk.

import {mkdirSync, readdirSync, existsSync} from "node:fs";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import {buildMod} from "./build-mod.js";
import {resolvePackage} from "../src/server/ModCache.js";
import {ModLockfile} from "../src/server/ModLockfile.js";
import {GAME_VERSION} from "../src/common/constants.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODS_DIR = join(REPO_ROOT, "src/mods");

// The loadout order src/mods/loadout.js registers in; the lockfile's order assigns the positional
// ids, so it has to match or existing saves stop loading.
const LOADOUT = ["BaseTextures", "Logistics", "BaseGame", "Fluids", "CursorSync", "Market", "Notes"];

/**
 * Builds the whole loadout and returns its lockfile.
 * @param {string} outDir
 * @param {string} version
 * @returns {Promise<ModLockfile>}
 */
export async function publishBaseMods(outDir, version) {
    const known = readdirSync(MODS_DIR, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    const missing = known.filter(name => !LOADOUT.includes(name));
    if (missing.length > 0) {
        throw new Error(`src/mods has ${missing.join(", ")}, which this tool's loadout order does not list`);
    }
    mkdirSync(outDir, {recursive: true});
    const entries = [];
    for (const dir of LOADOUT) {
        const packageDir = join(outDir, dir);
        const manifest = await buildMod(join(MODS_DIR, dir), packageDir, {version});
        entries.push(await resolvePackage(pathToFileURL(packageDir).href));
        console.log(`  ${manifest.name} ${manifest.version} -> ${packageDir}`);
    }
    return new ModLockfile(entries);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const {values: args} = parseArgs({
        options: {
            "out": {type: "string", default: join(REPO_ROOT, "dist-mods")},
            "lockfile": {type: "string", default: join(REPO_ROOT, "mods.json")},
            "version": {type: "string", default: GAME_VERSION},
        },
    });
    const outDir = resolve(args.out);
    const lockfile = await publishBaseMods(outDir, args.version);
    if (existsSync(args.lockfile)) {
        // Keep the pinned order of an existing lockfile honest: this tool only ever writes the
        // in-repo loadout, so a hand-edited file with extra mods must not be silently replaced.
        const current = ModLockfile.read(args.lockfile);
        const extra = current.mods.filter(entry => lockfile.find(entry.name) === null);
        if (extra.length > 0) {
            throw new Error(
                `${args.lockfile} also pins ${extra.map(entry => entry.name).join(", ")}; ` +
                "rewriting it would drop them — edit it by hand or point --lockfile elsewhere",
            );
        }
    }
    lockfile.write(args.lockfile);
    console.log(`${args.lockfile}: ${lockfile.mods.length} mods pinned`);
}
