// Every mod this build carries, as directory names in load order: the mods in src/mods, then the
// ones in dev-mods, each root sorted by name. A dev mod loads after every built-in one, so what a
// checkout is working on can never renumber the positional typeIds and wireIds a save is keyed to.
//
// Names only, and no mod is loaded to produce them — the mods screen draws a row per mod, and must
// not drag the mods themselves (and pixi with them) into the main bundle. The modules behind these
// names are modSources.js.
//
// This is the raw-node half: tests and a server run from a checkout, where the mods are files. Every
// vite build aliases this module to modDirs.vite.js, which globs the same two roots at build time,
// so a bundled client or server reads no directory at runtime.

import {existsSync, readdirSync} from "node:fs";
import {join} from "node:path";

export const MODS_ROOT = "src/mods";
// Gitignored: a mod being developed against this checkout is cloned or symlinked in here.
export const DEV_MODS_ROOT = "dev-mods";
export const DECLARATION_FILE = "declaration.js";
export const SIM_FILE = "sim.js";
export const CLIENT_FILE = "client.js";

/**
 * @param {string} root
 * @param {string} dir a directory name under it
 * @param {string} file
 * @returns {boolean}
 */
export function modHasFile(root, dir, file) {
    return readdirSync(join(root, dir)).includes(file);
}

/**
 * The mod directories in one root, in load order. A root that is not there holds no mods.
 * @param {string} root
 * @returns {string[]}
 */
export function dirsIn(root) {
    if (!existsSync(root)) {
        return [];
    }
    return readdirSync(root, {withFileTypes: true})
        .filter(entry => entry.isDirectory() && modHasFile(root, entry.name, DECLARATION_FILE))
        .map(entry => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

export const MOD_ROOTS = new Map();
for (const root of [MODS_ROOT, DEV_MODS_ROOT]) {
    for (const dir of dirsIn(root)) {
        if (MOD_ROOTS.has(dir)) {
            throw new Error(`${join(root, dir)} has the same name as ${join(MOD_ROOTS.get(dir), dir)}`);
        }
        MOD_ROOTS.set(dir, root);
    }
}

export const MOD_DIRS = Array.from(MOD_ROOTS.keys());
