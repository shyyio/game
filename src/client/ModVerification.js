// Which of a server's pinned mods this client is willing to run. A mod bundle is evaluated from a
// blob URL, so it runs same-origin with the client and reaches everything the page can — the pin
// list a server serves is therefore a claim, not a credential. Two hash sets answer it: the base
// mods this client was built with, and what the registry's maintainer reviewed and published.

import {contentNameHex, integrityHex} from "@/common/ModIntegrity.js";
import {BASE_MOD_HASHES, DEV} from "@/common/env.js";
import {listMods} from "@/client/ModRegistryClient.js";
import DeviceSettings, {DEVICE_SETTING_UNVERIFIED_MODS} from "@/client/state/DeviceSettings.js";

const ENTRY_FILE = "mod.js";

// Opens the refusal, so the join screen can offer the opt-in beside it.
export const UNVERIFIED_MODS_REFUSAL = "Unverified mods on this server: ";

/**
 * Every bundle hash the registry publishes, across every listed mod and version.
 * @param {object[]} listings the registry index's mods
 * @returns {Set<string>} lowercase hex sha-256
 */
export function registryModHashes(listings) {
    const hashes = new Set();
    for (const listing of listings) {
        for (const version of listing.versions) {
            if (version.artifacts === null || typeof version.artifacts !== "object") {
                continue;
            }
            const published = version.artifacts[ENTRY_FILE];
            if (published === undefined) {
                continue;
            }
            hashes.add(integrityHex(published));
        }
    }
    return hashes;
}

/**
 * Every bundle hash this client will run: what the registry publishes, and the base mods the client
 * was built with, which need no third-party vouching because they are its own code.
 * @param {object[]} listings the registry index's mods
 * @param {string[]} baseModHashes lowercase hex sha-256, from the build
 * @returns {Set<string>}
 */
export function approvedModHashes(listings, baseModHashes) {
    const approved = registryModHashes(listings);
    for (const hash of baseModHashes) {
        approved.add(hash);
    }
    return approved;
}

/**
 * The mods a server pins that no approved hash covers.
 * @param {object[]} mods the served index's mods
 * @param {Set<string>} approved lowercase hex sha-256
 * @returns {string[]} their names
 */
export function unverifiedMods(mods, approved) {
    return mods.filter(mod => !approved.has(contentNameHex(mod.entry))).map(mod => mod.name);
}

/**
 * Refuses a server's loadout before a byte of it is evaluated, unless the player has opted in. A
 * server pinning only this client's own base mods never reaches the registry.
 * @param {object[]} mods the served index's mods
 * @returns {Promise<void>}
 */
export async function assertModsVerified(mods) {
    if (DEV || DeviceSettings.getBoolean(DEVICE_SETTING_UNVERIFIED_MODS, false)) {
        return;
    }
    if (unverifiedMods(mods, new Set(BASE_MOD_HASHES)).length === 0) {
        return;
    }
    const unverified = unverifiedMods(mods, approvedModHashes(await listMods(), BASE_MOD_HASHES));
    if (unverified.length === 0) {
        return;
    }
    throw new Error(`${UNVERIFIED_MODS_REFUSAL}${unverified.join(", ")}.`);
}
