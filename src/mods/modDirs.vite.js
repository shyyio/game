// modDirs.js for a vite build: the same two exports, from lazy globs of the two roots. Nothing the
// globs name is imported, so a screen that only draws mod names costs one array. Every vite config
// aliases @/mods/modDirs.js to this file (see vite.aliases.js).
//
// The dev-mods glob sits in devModDirs.vite.js, which a production build swaps for an empty module,
// so a mod being worked on cannot reach a bundle.

import {DEV_MOD_DECLARATION_PATHS} from "@/mods/devModDirs.vite.js";

export const MODS_ROOT = "src/mods";
export const DEV_MODS_ROOT = "dev-mods";

/**
 * @param {string[]} paths a glob's declaration paths
 * @param {string} root the root those paths start with
 * @returns {string[]} the mod directories it names, in load order
 */
function dirsOf(paths, root) {
    return paths
        .map(path => path.slice(`/${root}/`.length).split("/")[0])
        .sort((left, right) => left.localeCompare(right));
}

export const MOD_ROOTS = new Map();
for (const dir of dirsOf(Object.keys(import.meta.glob("/src/mods/*/declaration.js")), MODS_ROOT)) {
    MOD_ROOTS.set(dir, MODS_ROOT);
}
for (const dir of dirsOf(DEV_MOD_DECLARATION_PATHS, DEV_MODS_ROOT)) {
    if (MOD_ROOTS.has(dir)) {
        throw new Error(`${DEV_MODS_ROOT}/${dir} has the same name as ${MODS_ROOT}/${dir}`);
    }
    MOD_ROOTS.set(dir, DEV_MODS_ROOT);
}

export const MOD_DIRS = Array.from(MOD_ROOTS.keys());
