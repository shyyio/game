// The dev-mods half of modDirs.vite.js: the declaration paths under dev-mods/, from a lazy glob, so
// naming the mods imports none of them. A production build aliases this module to
// devMods.production.js (see vite.aliases.js): vite expands a glob wherever it is written, so a
// `DEV ?` guard around one would still bundle what it names.

export const DEV_MOD_DECLARATION_PATHS = Object.keys(import.meta.glob("/dev-mods/*/declaration.js"));
