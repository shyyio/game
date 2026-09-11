// modSources.js for a vite build: the same export, globbed at build time instead of read from disk,
// so a bundled client or server carries its mods and reads no directory at runtime. Every vite
// config aliases @/mods/modSources.js to this file (see vite.aliases.js). The dev-mods globs sit in
// devModSources.vite.js, which a production build swaps for an empty module.

import {MOD_DIRS, MOD_ROOTS} from "@/mods/modDirs.js";
import {DEV_MOD_DECLARATIONS, DEV_MOD_SIMS} from "@/mods/devModSources.vite.js";

const DECLARATIONS = Object.assign({}, import.meta.glob("/src/mods/*/declaration.js", {eager: true}), DEV_MOD_DECLARATIONS);
const SIMS = Object.assign({}, import.meta.glob("/src/mods/*/sim.js", {eager: true}), DEV_MOD_SIMS);

/**
 * @param {object} modules a glob's path -> module map
 * @param {string} dir
 * @param {string} file
 * @returns {object|null} the part, or null when the mod does not have it
 */
function partOf(modules, dir, file) {
    const module = modules[`/${MOD_ROOTS.get(dir)}/${dir}/${file}`];
    if (module === undefined) {
        return null;
    }
    return module;
}

export const MOD_SOURCES = MOD_DIRS.map(dir => ({
    dir,
    declaration: partOf(DECLARATIONS, dir, "declaration.js"),
    sim: partOf(SIMS, dir, "sim.js"),
}));
