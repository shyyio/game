// The published mod catalog, read straight from the registry's static index. Browsing mods needs no
// session and touches no game server — it is the same index.json a server operator's `mods add`
// resolves names against.

const MOD_REGISTRY_URL = "https://mods.spupgame.com";

// Where a mod author opens the PR that lists their mod, and how to do it.
export const MOD_LISTING_GUIDE_URL = "https://github.com/shyyio/spup-mods#listing-a-mod";

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
