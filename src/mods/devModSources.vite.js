// The dev-mods half of modSources.vite.js and clientLoadout.js: every part module under dev-mods/,
// eagerly. A production build aliases this module to devMods.production.js (see vite.aliases.js):
// vite hoists an eager glob's imports wherever it is written, so a `DEV ?` guard around one would
// still bundle what it names.

export const DEV_MOD_DECLARATIONS = import.meta.glob("/dev-mods/*/declaration.js", {eager: true});
export const DEV_MOD_SIMS = import.meta.glob("/dev-mods/*/sim.js", {eager: true});
export const DEV_MOD_CLIENTS = import.meta.glob("/dev-mods/*/client.js", {eager: true});
