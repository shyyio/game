// Local play's own mod list. A local game is its own server, so it gets what an operator gets: an
// ordered, hash-pinned list, in the same format as a server's mods.json.
//
// The model and its store only; loading the packages it names is @/client/LocalModLoader.js, which
// is what pulls the client SDK in.
//
// The base loadout the client ships (@/mods/clientLoadout.js) always registers first, in its own
// fixed order, so a chosen mod only ever appends typeIds after it. Base mods are stored as
// *exclusions* rather than selections: nothing stored means every base mod loads, which is exactly
// the loadout local play had before it could be chosen at all.
//
// A chosen mod normally tracks the newest published version this client can load. The stored version
// and hashes are the last resolution of that, kept so a game still starts when the registry is
// unreachable and refreshed whenever it answers. A player who needs one exact version pins it
// instead, and then nothing re-resolves it.

import {ModLockEntry, MANIFEST_FILE} from "@/common/ModLockfile.js";
import {ModManifest, SDK_VERSION} from "@/common/ModManifest.js";
import {integrityHex} from "@/common/ModIntegrity.js";
import {DEV_TOOLS} from "@/common/env.js";
import {BASE_MOD_DIRS, baseModName} from "@/mods/baseMods.js";

// Where a mod's code comes from: the public registry, or a bare URL a dev build reloads on every
// start.
export const LOCAL_MOD_SOURCE_REGISTRY = "registry";
export const LOCAL_MOD_SOURCE_URL = "url";

const LOCAL_MOD_SOURCES = [LOCAL_MOD_SOURCE_REGISTRY, LOCAL_MOD_SOURCE_URL];

const MOD_KEYS = ["source", "name", "title", "url", "version", "integrity", "pinned"];

// localStorage key holding the choices.
const STORAGE_LOADOUT = "spup.local-loadout";

// Every base mod's package name, in the order clientLoadout() registers them.
export const BASE_MOD_NAMES = BASE_MOD_DIRS.map(dir => baseModName(dir));

/**
 * One mod a local game loads on top of the base loadout.
 */
export class LocalMod {

    /**
     * @param {string} source one of LOCAL_MOD_SOURCE_*
     * @param {string} name the kebab-case identifier, which is this mod's identity in a loadout
     * @param {string} title the display name
     * @param {string} url the package's base URL, ending in "/"
     * @param {string} version
     * @param {Map<string, string>|null} integrity package file -> "sha256-...", null off a bare URL
     * @param {boolean} pinned whether this exact version was chosen, rather than tracking the newest
     */
    constructor(
        source,
        name,
        title,
        url,
        version,
        integrity,
        pinned,
    ) {
        this.source = source;
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
        return this.source === LOCAL_MOD_SOURCE_REGISTRY && !this.pinned;
    }

    /**
     * @returns {ModLockEntry}
     */
    get lockEntry() {
        if (this.integrity === null) {
            throw new Error(`Mod "${this.name}" has no file hashes, so it has no lockfile entry`);
        }
        return new ModLockEntry(this.url, this.name, this.version, this.integrity);
    }

    /**
     * @returns {object}
     */
    toJSON() {
        const json = {
            source: this.source,
            name: this.name,
            title: this.title,
            url: this.url,
            version: this.version,
            pinned: this.pinned,
        };
        if (this.integrity !== null) {
            json.integrity = Object.fromEntries(this.integrity);
        }
        return json;
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
        if (!LOCAL_MOD_SOURCES.includes(json.source)) {
            throw new Error(`Unknown local loadout source: ${JSON.stringify(json.source)}`);
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
        let integrity = null;
        if (json.source === LOCAL_MOD_SOURCE_REGISTRY) {
            integrity = parseIntegrity(json.integrity, json.name);
        }
        else if (json.pinned) {
            throw new Error(`Mod "${json.name}" is served straight off a URL, which has no version to pin`);
        }
        return new LocalMod(json.source, json.name, json.title, json.url, json.version, integrity, json.pinned);
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
            source: LOCAL_MOD_SOURCE_REGISTRY,
            name: listing.name,
            title: titleOf(listing),
            url: version.url,
            version: version.version,
            integrity: version.artifacts,
            pinned: pinned,
        });
    }

    /**
     * The entry for a package served straight off a URL, read off the manifest it actually serves so
     * a typo fails while the player is looking at it rather than at the next game start.
     * @param {string} url the package's base URL
     * @returns {Promise<LocalMod>}
     */
    static async fromUrl(url) {
        if (!DEV_TOOLS) {
            throw new Error("Loading a mod straight off a URL needs a build with the dev tools on");
        }
        const base = url.endsWith("/") ? url : `${url}/`;
        const response = await fetch(`${base}${MANIFEST_FILE}`);
        if (!response.ok) {
            throw new Error(`No mod package at ${base} (${response.status})`);
        }
        const manifest = ModManifest.parse(await response.json());
        if (manifest.sdkVersion !== SDK_VERSION) {
            throw new Error(
                `${manifest.name} ${manifest.version} is built for game SDK ${manifest.sdkVersion}; `
                + `this client speaks ${SDK_VERSION}`,
            );
        }
        return new LocalMod(
            LOCAL_MOD_SOURCE_URL, manifest.name, manifest.displayName, base, manifest.version, null, false,
        );
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
 * The mods a local game loads after the base loadout, in registration order.
 */
export class LocalLoadout {

    /**
     * @param {LocalMod[]} mods
     * @param {string[]} [excludedBase] base mod names the player has turned off
     */
    constructor(mods, excludedBase=[]) {
        for (const mod of mods) {
            // A name is one mod. The built-in copy registers first whatever this list says, so a
            // second package under the same name is that mod loaded twice, not another mod.
            if (BASE_MOD_NAMES.includes(mod.name)) {
                throw new Error(`Mod "${mod.name}" is built into the client, so a package may not carry that name`);
            }
        }
        this.mods = mods;
        this.excludedBase = excludedBase;
    }

    /**
     * Whether a base mod loads. Unknown names answer true: this is a stored preference, and a base
     * mod renamed or dropped between client versions must not silently turn off a different one.
     * @param {string} name a base mod's package name
     * @returns {boolean}
     */
    baseEnabled(name) {
        return !this.excludedBase.includes(name);
    }

    /**
     * The base mods that load, in registration order.
     * @returns {string[]}
     */
    get enabledBase() {
        return BASE_MOD_NAMES.filter(name => this.baseEnabled(name));
    }

    /**
     * @param {string} name a base mod's package name
     * @param {boolean} enabled
     * @returns {LocalLoadout}
     */
    withBase(name, enabled) {
        if (!BASE_MOD_NAMES.includes(name)) {
            throw new Error(`No base mod called "${name}"`);
        }
        if (enabled) {
            return new LocalLoadout(this.mods, this.excludedBase.filter(excluded => excluded !== name));
        }
        if (!this.baseEnabled(name)) {
            return this;
        }
        return new LocalLoadout(this.mods, [...this.excludedBase, name]);
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
            return new LocalLoadout([...this.mods, mod], this.excludedBase);
        }
        const mods = [...this.mods];
        mods[at] = mod;
        return new LocalLoadout(mods, this.excludedBase);
    }

    /**
     * @param {string} name
     * @returns {LocalLoadout}
     */
    without(name) {
        return new LocalLoadout(this.mods.filter(mod => mod.name !== name), this.excludedBase);
    }

    /**
     * @returns {object}
     */
    toJSON() {
        return {mods: this.mods.map(mod => mod.toJSON()), excludedBase: this.excludedBase};
    }

    /**
     * @param {object} json
     * @returns {LocalLoadout}
     */
    static parse(json) {
        if (json === null || typeof json !== "object" || !Array.isArray(json.mods)) {
            throw new Error("A local loadout must hold a `mods` array");
        }
        const mods = json.mods.map(mod => LocalMod.parse(mod));
        const names = new Set();
        for (const mod of mods) {
            if (names.has(mod.name)) {
                throw new Error(`The local loadout lists "${mod.name}" twice`);
            }
            names.add(mod.name);
        }
        return new LocalLoadout(mods, parseExcludedBase(json.excludedBase));
    }
}

/**
 * @param {*} value
 * @returns {string[]}
 */
function parseExcludedBase(value) {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.some(name => typeof name !== "string")) {
        throw new Error("A local loadout's `excludedBase` must be an array of base mod names");
    }
    return value;
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
    }), loadout.excludedBase);
}

/**
 * The `mods.json` a server needs in order to run this loadout: every base mod the client ships,
 * pinned to the registry's copy of this game version, then the chosen mods. The order is the order
 * the client registers them in, so a server built from this assigns the same positional ids.
 *
 * A base mod the registry does not publish at this version cannot be pinned, and a partial lockfile
 * would silently hand the server a different loadout, so the whole thing is withheld rather than
 * trimmed. Mods loaded off a bare URL are never in it: they have no hashes, and their URL means
 * nothing to a server.
 * @param {LocalLoadout} loadout
 * @param {object[]} listings the registry index's mods
 * @param {string} gameVersion
 * @returns {{lockfile: object|null, missing: string[], skipped: string[]}}
 */
export function serverLockfile(loadout, listings, gameVersion) {
    const missing = [];
    const skipped = [];
    const entries = [];
    for (const name of loadout.enabledBase) {
        const listing = listings.find(candidate => candidate.name === name);
        const version = publishedAt(listing, gameVersion);
        if (version === null) {
            missing.push(name);
            continue;
        }
        entries.push(LocalMod.fromListing(listing, version, true).lockEntry.toJSON());
    }
    for (const mod of loadout.mods) {
        if (mod.source === LOCAL_MOD_SOURCE_URL) {
            skipped.push(mod.name);
            continue;
        }
        entries.push(mod.lockEntry.toJSON());
    }
    if (missing.length > 0) {
        return {lockfile: null, missing, skipped};
    }
    return {lockfile: {mods: entries}, missing, skipped};
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
