// modSources.js for a vite build: the same export, globbed at build time instead of read from disk,
// so a bundled client or server carries its mods and reads no directory at runtime. Every vite
// config aliases @/mods/modSources.js to this file (see vite.aliases.js).

import {MOD_DIRS, MOD_ROOTS} from "@/mods/modDirs.js";

const DECLARATIONS = Object.assign(
    {},
    import.meta.glob("/src/mods/*/declaration.js", {eager: true}),
    import.meta.env.DEV ? import.meta.glob("/dev-mods/*/declaration.js", {eager: true}) : {},
);
const SIMS = Object.assign(
    {},
    import.meta.glob("/src/mods/*/sim.js", {eager: true}),
    import.meta.env.DEV ? import.meta.glob("/dev-mods/*/sim.js", {eager: true}) : {},
);

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
