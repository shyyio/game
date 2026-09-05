// modDirs.js for a vite build: the same two exports, from lazy globs of the two roots. Nothing the
// globs name is imported, so a screen that only draws mod names costs one array. Every vite config
// aliases @/mods/modDirs.js to this file (see vite.aliases.js).
//
// dev-mods/ is a dev server's business only: a production build globs nothing there, so a mod being
// worked on cannot reach a bundle.

export const MODS_ROOT = "src/mods";
export const DEV_MODS_ROOT = "dev-mods";

/**
 * @param {object} declarations a glob's path -> module map
 * @param {string} root the root those paths start with
 * @returns {string[]} the mod directories it names, in load order
 */
function dirsOf(declarations, root) {
    return Object.keys(declarations)
        .map(path => path.slice(`/${root}/`.length).split("/")[0])
        .sort((left, right) => left.localeCompare(right));
}

export const MOD_ROOTS = new Map();
for (const dir of dirsOf(import.meta.glob("/src/mods/*/declaration.js"), MODS_ROOT)) {
    MOD_ROOTS.set(dir, MODS_ROOT);
}
if (import.meta.env.DEV) {
    for (const dir of dirsOf(import.meta.glob("/dev-mods/*/declaration.js"), DEV_MODS_ROOT)) {
        if (MOD_ROOTS.has(dir)) {
            throw new Error(`${DEV_MODS_ROOT}/${dir} has the same name as ${MODS_ROOT}/${dir}`);
        }
        MOD_ROOTS.set(dir, DEV_MODS_ROOT);
    }
}

export const MOD_DIRS = Array.from(MOD_ROOTS.keys());
