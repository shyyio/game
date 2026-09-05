// What a mod's directory name says: the package name it carries, and the name a player reads.
//
// Directories load in name order, so a numeric prefix places a mod in the loadout (`99-my-mod` loads
// last). Names sort lexicographically, so pad them: `10-` sorts before `9-`. The prefix orders only,
// and is dropped from both names, so a mod keeps its identity across a reorder.
//
// Importless: the mods screen reads these to draw a row per mod, and must not drag the mods
// themselves (and pixi with them) out of their lazy chunk and into the main bundle.

// A leading number and its separator order a mod without naming it.
const ORDER_PREFIX = /^\d+[-_]/;

/**
 * @param {string} dir a directory name, not a path
 * @returns {string} the mod's package name
 */
export function modName(dir) {
    return dir.replace(ORDER_PREFIX, "");
}

/**
 * @param {string} dir a directory name, not a path
 * @returns {string} the mod's display name (base-textures -> Base Textures)
 */
export function modTitle(dir) {
    return modName(dir)
        .split(/[-_\s]+/)
        .filter(word => word !== "")
        .map(word => `${word[0].toUpperCase()}${word.slice(1)}`)
        .join(" ");
}
