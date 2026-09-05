// Local play's own mod list. A local game is its own server, so it gets what an operator gets: an
// ordered, hash-pinned list, in the same format as a server's pinned mods.
//
// The model and its store only; loading the packages it names is @/client/LocalModLoader.js, which
// is what pulls the client SDK in.
//
// The base loadout the client ships (@/mods/clientLoadout.js) registers first, in its own fixed
// order, so a chosen mod only ever appends typeIds after it; that is the built-in mode, and what an
// empty loadout means. With built-in mods off, the base mods are chosen from the registry like any
// other, version and all.
//
// A chosen mod normally tracks the newest published version this client can load. The stored version
// and hashes are the last resolution of that, kept so a game still starts when the registry is
// unreachable and refreshed whenever it answers. A player who needs one exact version pins it
// instead, and then nothing re-resolves it.

import {ModLockEntry, ModLockfile, MANIFEST_FILE} from "@/common/ModLockfile.js";
import {ModManifest, SDK_VERSION} from "@/common/ModManifest.js";
import {integrityHex} from "@/common/ModIntegrity.js";
import {DEV_TOOLS} from "@/common/env.js";
import {MOD_DIRS} from "@/mods/modDirs.js";
import {modName} from "@/mods/modNames.js";

// Every mod here comes from the registry: one being developed against a checkout is loaded from
// dev-mods/, not fetched.
const MOD_KEYS = ["name", "title", "url", "version", "integrity", "pinned"];

// "excludedBase" is what stored loadouts carried before the built-in mods became one choice.
const LOADOUT_KEYS = ["mods", "builtIn", "excludedBase"];

// localStorage key holding the choices.
const STORAGE_LOADOUT = "spup.local-loadout";

// Every base mod's package name, in the order clientLoadout() registers them.
export const BASE_MOD_NAMES = MOD_DIRS.map(dir => modName(dir));

/**
 * One mod a local game loads on top of the base loadout.
 */
export class LocalMod {

    /**
     * @param {string} name the kebab-case identifier, which is this mod's identity in a loadout
     * @param {string} title the display name
     * @param {string} url the package's base URL, ending in "/"
     * @param {string} version
     * @param {Map<string, string>} integrity package file -> "sha256-..."
     * @param {boolean} pinned whether this exact version was chosen, rather than tracking the newest
     */
    constructor(
        name,
        title,
        url,
        version,
        integrity,
        pinned,
    ) {
        this.name = name;
        this.title = title;
        this.url = url;
        this.version = version;
        this.integrity = integrity;
        this.pinned = pinned;
    }

    /**
     * Whether this mod re-resolves to the newest compatible published version at every start.
     * @returns {boolean}
     */
    get tracksLatest() {
        return !this.pinned;
    }

    /**
     * @returns {ModLockEntry}
     */
    get lockEntry() {
        return new ModLockEntry(this.url, this.name, this.version, this.integrity);
    }

    /**
     * @returns {object}
     */
    toJSON() {
        return {
            name: this.name,
            title: this.title,
            url: this.url,
            version: this.version,
            integrity: Object.fromEntries(this.integrity),
            pinned: this.pinned,
        };
    }

    /**
     * @param {object} json
     * @returns {LocalMod}
     */
    static parse(json) {
        if (json === null || typeof json !== "object" || Array.isArray(json)) {
            throw new Error("A local loadout entry must be an object");
        }
        for (const key of Object.keys(json)) {
            if (!MOD_KEYS.includes(key)) {
                throw new Error(`Unknown key "${key}" in a local loadout entry`);
            }
        }
        if (typeof json.name !== "string" || typeof json.title !== "string" || typeof json.version !== "string") {
            throw new Error(`A local loadout entry is missing its name, title, or version: ${JSON.stringify(json)}`);
        }
        if (typeof json.url !== "string" || !json.url.endsWith("/")) {
            throw new Error(`A local loadout entry's url must end in "/": ${JSON.stringify(json.url)}`);
        }
        if (typeof json.pinned !== "boolean") {
            throw new Error(`Mod "${json.name}" does not say whether its version is pinned`);
        }
        const integrity = parseIntegrity(json.integrity, json.name);
        return new LocalMod(json.name, json.title, json.url, json.version, integrity, json.pinned);
    }

    /**
     * The entry a registry listing's version describes.
     * @param {object} listing a listed mod, as the registry index publishes it
     * @param {object} version one of that mod's published versions
     * @param {boolean} pinned
     * @returns {LocalMod}
     */
    static fromListing(listing, version, pinned) {
        if (version.artifacts === null || typeof version.artifacts !== "object" || version.artifacts === undefined) {
            throw new Error(`The registry publishes no file hashes for ${listing.name} ${version.version}`);
        }
        return LocalMod.parse({
            name: listing.name,
            title: titleOf(listing),
            url: version.url,
            version: version.version,
            integrity: version.artifacts,
            pinned: pinned,
        });
    }

}

/**
 * @param {*} value
 * @param {string} name the mod's name, for error messages
 * @returns {Map<string, string>}
 */
function parseIntegrity(value, name) {
    if (value === null || value === undefined || typeof value !== "object") {
        throw new Error(`Mod "${name}" has no integrity map`);
    }
    const integrity = new Map();
    for (const [file, hash] of Object.entries(value)) {
        integrityHex(hash);
        integrity.set(file, hash);
    }
    if (!integrity.has(MANIFEST_FILE)) {
        throw new Error(`Mod "${name}" does not pin ${MANIFEST_FILE}`);
    }
    return integrity;
}

/**
 * What a listed mod is called on screen.
 * @param {object} listing
 * @returns {string}
 */
function titleOf(listing) {
    if (typeof listing.title !== "string" || listing.title === "") {
        return listing.name;
    }
    return listing.title;
}

/**
 * A listed mod's versions this client can load, newest first. A bundle built against another SDK
 * version does not load at all, so an incompatible one is never offered rather than offered and then
 * refused at start.
 * @param {object} listing a listed mod, as the registry index publishes it
 * @returns {object[]}
 */
export function compatibleVersions(listing) {
    if (!Array.isArray(listing.versions)) {
        return [];
    }
    return [...listing.versions].reverse().filter(version => version.sdkVersion === SDK_VERSION);
}

/**
 * Every version a listed mod has published, newest first, loadable or not.
 * @param {object} listing
 * @returns {object[]}
 */
export function publishedVersions(listing) {
    if (!Array.isArray(listing.versions)) {
        return [];
    }
    return [...listing.versions].reverse();
}

/**
 * Whether a published version was built against this game's SDK, so this client can load it.
 * @param {object} version
 * @returns {boolean}
 */
export function versionLoadable(version) {
    return version.sdkVersion === SDK_VERSION;
}

/**
 * The newest published version this client can load, or null when the listing offers none.
 * @param {object} listing
 * @returns {object|null}
 */
export function latestCompatibleVersion(listing) {
    const versions = compatibleVersions(listing);
    if (versions.length === 0) {
        return null;
    }
    return versions[0];
}

/**
 * The mods a local game loads, in registration order: the built-in base loadout first when
 * `builtIn` is on, then `mods`.
 */
export class LocalLoadout {

    /**
     * @param {LocalMod[]} mods
     * @param {boolean} [builtIn] whether the base mods run as built into the game
     */
    constructor(mods, builtIn=true) {
        if (builtIn) {
            for (const mod of mods) {
                // A name is one mod. The built-in copy registers first whatever this list says, so
                // a second package under the same name is that mod loaded twice, not another mod.
                if (BASE_MOD_NAMES.includes(mod.name)) {
                    throw new Error(`Mod "${mod.name}" is built into the client, so a package may not carry that name`);
                }
            }
        }
        this.mods = mods;
        this.builtIn = builtIn;
    }

    /**
     * Turning built-in mods on drops any base mod chosen from the registry, since the built-in copy
     * takes its name.
     * @param {boolean} on
     * @returns {LocalLoadout}
     */
    withBuiltIn(on) {
        if (!on) {
            return new LocalLoadout(this.mods, false);
        }
        return new LocalLoadout(this.mods.filter(mod => !BASE_MOD_NAMES.includes(mod.name)), true);
    }

    /**
     * Whether anything here re-resolves against the registry.
     * @returns {boolean}
     */
    get tracksLatest() {
        return this.mods.some(mod => mod.tracksLatest);
    }

    /**
     * @param {string} name
     * @returns {LocalMod|null}
     */
    find(name) {
        const found = this.mods.find(mod => mod.name === name);
        if (found === undefined) {
            return null;
        }
        return found;
    }

    /**
     * `mod` appended, or swapped in where a mod of that name already sits (a version change keeps
     * its position, since moving it would shift the typeIds after it).
     * @param {LocalMod} mod
     * @returns {LocalLoadout}
     */
    with(mod) {
        const at = this.mods.findIndex(candidate => candidate.name === mod.name);
        if (at === -1) {
            return new LocalLoadout([...this.mods, mod], this.builtIn);
        }
        const mods = [...this.mods];
        mods[at] = mod;
        return new LocalLoadout(mods, this.builtIn);
    }

    /**
     * @param {string} name
     * @returns {LocalLoadout}
     */
    without(name) {
        return new LocalLoadout(this.mods.filter(mod => mod.name !== name), this.builtIn);
    }

    /**
     * `name` moved `offset` places along the load order (which assigns the positional ids, and
     * which texture wins a name), clamped to the ends.
     * @param {string} name
     * @param {number} offset
     * @returns {LocalLoadout}
     */
    withMoved(name, offset) {
        const from = this.mods.findIndex(mod => mod.name === name);
        if (from === -1) {
            throw new Error(`Mod "${name}" is not chosen, so it has no place in the load order`);
        }
        const to = Math.max(0, Math.min(this.mods.length - 1, from + offset));
        const mods = this.mods.slice();
        const [moved] = mods.splice(from, 1);
        mods.splice(to, 0, moved);
        return new LocalLoadout(mods, this.builtIn);
    }

    /**
     * @returns {object}
     */
    toJSON() {
        return {mods: this.mods.map(mod => mod.toJSON()), builtIn: this.builtIn};
    }

    /**
     * The loadout a server's pinned mods describe. Base mods pinned to the server's own built copies
     * (file: URLs) are the built-in mode; base mods pinned anywhere else were chosen from the
     * registry, and every such pin reads back at exactly its version and URL.
     * @param {ModLockfile} lockfile
     * @param {object[]} listings the registry index, for titles
     * @returns {LocalLoadout}
     */
    static fromLockfile(lockfile, listings) {
        const base = lockfile.mods.filter(entry => BASE_MOD_NAMES.includes(entry.name));
        const builtIn = base.length > 0 && base.every(entry => entry.url.startsWith("file:"));
        const mods = [];
        for (const entry of lockfile.mods) {
            if (builtIn && BASE_MOD_NAMES.includes(entry.name)) {
                continue;
            }
            const listing = listings.find(candidate => candidate.name === entry.name);
            const title = listing === undefined ? entry.name : titleOf(listing);
            mods.push(new LocalMod(entry.name, title, entry.url, entry.version, entry.integrity, true));
        }
        return new LocalLoadout(mods, builtIn);
    }

    /**
     * @param {object} json
     * @returns {LocalLoadout}
     */
    static parse(json) {
        if (json === null || typeof json !== "object" || !Array.isArray(json.mods)) {
            throw new Error("A local loadout must hold a `mods` array");
        }
        for (const key of Object.keys(json)) {
            if (!LOADOUT_KEYS.includes(key)) {
                throw new Error(`Unknown key "${key}" in a local loadout`);
            }
        }
        const mods = json.mods.map(mod => LocalMod.parse(mod));
        const names = new Set();
        for (const mod of mods) {
            if (names.has(mod.name)) {
                throw new Error(`The local loadout lists "${mod.name}" twice`);
            }
            names.add(mod.name);
        }
        return new LocalLoadout(mods, parseBuiltIn(json));
    }
}

/**
 * Whether the built-in mods load. A loadout stored before this was one choice instead listed the
 * base mods the player had turned off: an empty list means the same as the choice on, a non-empty
 * one names a loadout this build has no way to express.
 * @param {object} json
 * @returns {boolean}
 */
function parseBuiltIn(json) {
    if (json.excludedBase !== undefined) {
        if (!Array.isArray(json.excludedBase) || json.excludedBase.length > 0) {
            throw new Error("This loadout turned off part of the built-in mods, which is no longer a choice.");
        }
        return true;
    }
    if (json.builtIn === undefined) {
        return true;
    }
    if (typeof json.builtIn !== "boolean") {
        throw new Error("A local loadout's `builtIn` must be true or false");
    }
    return json.builtIn;
}

/**
 * `loadout` with every version-tracking mod moved to the newest published version this client can
 * load. A mod the registry no longer lists, or no longer lists compatibly, keeps the version it
 * already resolved to: delisting stops new installs, and a game that was already running keeps
 * running until its player acts — the same bound a server's operator has.
 * @param {LocalLoadout} loadout
 * @param {object[]} listings the registry index's mods
 * @returns {LocalLoadout}
 */
export function refreshLoadout(loadout, listings) {
    return new LocalLoadout(loadout.mods.map((mod) => {
        if (!mod.tracksLatest) {
            return mod;
        }
        const listing = listings.find(candidate => candidate.name === mod.name);
        if (listing === undefined) {
            return mod;
        }
        const latest = latestCompatibleVersion(listing);
        if (latest === null) {
            return mod;
        }
        return LocalMod.fromListing(listing, latest, false);
    }), loadout.builtIn);
}

/**
 * The pins a server would run this loadout from: with built-in mods on, every base mod pinned as
 * `current` has it or at this game version from the registry, plus the chosen mods. A name `current`
 * already pins keeps that pin and its position, so a server's own base-mod builds survive a round
 * trip through the editor and no mod's positional typeId moves; the rest follow in load order. Base
 * mods the registry has not published at this version are reported as missing, and nothing is
 * exported.
 * @param {LocalLoadout} loadout
 * @param {object[]} listings the registry index
 * @param {string} gameVersion
 * @param {ModLockfile} [current] the server's pins as they are now
 * @returns {{lockfile: object|null, missing: string[]}}
 */
export function serverLockfile(loadout, listings, gameVersion, current=new ModLockfile([])) {
    const missing = [];
    const resolved = new Map();
    const base = loadout.builtIn ? BASE_MOD_NAMES : [];
    for (const name of base) {
        const pinned = current.find(name);
        if (pinned !== null) {
            resolved.set(name, pinned.toJSON());
            continue;
        }
        const listing = listings.find(candidate => candidate.name === name);
        const version = publishedAt(listing, gameVersion);
        if (version === null) {
            missing.push(name);
            continue;
        }
        resolved.set(name, LocalMod.fromListing(listing, version, true).lockEntry.toJSON());
    }
    for (const mod of loadout.mods) {
        const pinned = current.find(mod.name);
        if (pinned !== null && pinned.version === mod.version) {
            resolved.set(mod.name, pinned.toJSON());
            continue;
        }
        resolved.set(mod.name, mod.lockEntry.toJSON());
    }
    if (missing.length > 0) {
        return {lockfile: null, missing};
    }
    const order = current.mods.map(entry => entry.name).filter(name => resolved.has(name));
    for (const name of resolved.keys()) {
        if (!order.includes(name)) {
            order.push(name);
        }
    }
    return {lockfile: {mods: order.map(name => resolved.get(name))}, missing};
}

/**
 * A listing's published version with file hashes to pin, or null when there is none to pin.
 * @param {object|undefined} listing
 * @param {string} version
 * @returns {object|null}
 */
function publishedAt(listing, version) {
    if (listing === undefined || !Array.isArray(listing.versions)) {
        return null;
    }
    const found = listing.versions.find(candidate => candidate.version === version);
    if (found === undefined || found === null || typeof found.artifacts !== "object" || found.artifacts === null) {
        return null;
    }
    return found;
}

/**
 * The stored local loadout, empty when nothing has been chosen. A stored value that no longer parses
 * throws rather than being silently discarded — it is the pin list for code about to run.
 * @returns {LocalLoadout}
 */
export function readLocalLoadout() {
    const stored = localStorage.getItem(STORAGE_LOADOUT);
    if (stored === null) {
        return new LocalLoadout([]);
    }
    return LocalLoadout.parse(JSON.parse(stored));
}

/**
 * @param {LocalLoadout} loadout
 * @returns {void}
 */
export function writeLocalLoadout(loadout) {
    localStorage.setItem(STORAGE_LOADOUT, JSON.stringify(loadout.toJSON()));
}
