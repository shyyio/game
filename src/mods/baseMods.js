// The in-repo mods, in loadout order, and the two name transforms that turn a directory name into
// what a package and a player call it. Registration order is what assigns the positional typeIds and
// wireIds, so this list is the one copy of it — a second copy drifts and silently reassigns every id
// after the drift.
//
// Deliberately importless: the mods screen reads it to draw a row per base mod, and must not drag
// the mods themselves (and pixi with them) out of their lazy chunk and into the main bundle.
//
// The two transforms match tools/build-mod.js's packageName/displayTitle, which stay separate
// because that builder is published standalone and builds anyone's mod — it has no business knowing
// this game's loadout. src/test/loadout-order.spec.js holds the two copies to the same answers.

export const BASE_MOD_DIRS = [
    "BaseTextures",
    "Logistics",
    "BaseGame",
    "Fluids",
    "CursorSync",
    "Market",
    "Notes",
    "ProductionLog",
];

/**
 * The kebab-case package name for a mod directory (BaseTextures -> base-textures).
 * @param {string} dir a directory name, not a path
 * @returns {string}
 */
export function baseModName(dir) {
    return dir
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase();
}

/**
 * The display name for a mod directory (BaseTextures and base-textures both -> Base Textures).
 * @param {string} dir a directory name, not a path
 * @returns {string}
 */
export function baseModTitle(dir) {
    return dir
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[-_\s]+/)
        .filter(word => word !== "")
        .map(word => `${word[0].toUpperCase()}${word.slice(1)}`)
        .join(" ");
}
