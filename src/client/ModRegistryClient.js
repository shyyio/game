// The published mod catalog, read straight from the registry's static index. Browsing mods needs no
// session and touches no game server — it is the same index.json a server operator's `mods add`
// resolves names against.

const MOD_REGISTRY_URL = "https://mods.spupgame.com";

// Where a mod author opens the PR that lists their mod, and how to do it.
export const MOD_LISTING_GUIDE_URL = "https://github.com/shyyio/spup-mods#listing-a-mod";

// The listing tags a registry maintainer assigns — "official" is a review verdict, not something a
// mod says about itself, so tags ride on the listing and never on the author's mod.json. A tag the
// registry adds later still shows; this list only fixes the order the known ones sort in.
export const MOD_TAGS = ["official", "content", "tweaks", "cheats"];

/**
 * @param {string} tag
 * @returns {number}
 */
function tagRank(tag) {
    const rank = MOD_TAGS.indexOf(tag);
    if (rank === -1) {
        return MOD_TAGS.length;
    }
    return rank;
}

/**
 * What a listed mod is called on screen: its own display name, or the kebab-case identifier when
 * the listing has none. The identifier is what a lockfile pins, so it is never replaced, only
 * shown alongside.
 * @param {object} mod
 * @returns {string}
 */
export function displayNameOf(mod) {
    if (typeof mod.title !== "string" || mod.title === "") {
        return mod.name;
    }
    return mod.title;
}

/**
 * A listed mod's tags, known ones first.
 * @param {object} mod
 * @returns {string[]}
 */
export function tagsOf(mod) {
    if (!Array.isArray(mod.tags)) {
        return [];
    }
    const tags = mod.tags.filter(tag => typeof tag === "string");
    return tags.sort((left, right) => tagRank(left) - tagRank(right) || left.localeCompare(right));
}

/**
 * @returns {Promise<object[]>} the listed mods, newest version first within each
 */
export async function listMods() {
    const response = await fetch(`${MOD_REGISTRY_URL}/index.json`);
    if (!response.ok) {
        throw new Error(`The mod registry is unreachable (${response.status})`);
    }
    const index = await response.json();
    if (!Array.isArray(index.mods)) {
        throw new Error("The mod registry returned something unexpected");
    }
    return index.mods;
}
