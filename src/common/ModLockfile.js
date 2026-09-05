// An ordered list of packaged mods, each with the hash of every file it consists of. Order is loadout
// order (it assigns the positional typeIds/wireIds), so reordering is a save-breaking change. Nothing
// rewrites an entry implicitly — on a server only the admin page and the `mods` CLI rewrite the list
// in server.json, in the browser only
// the local-loadout editor.

import {integrityHex} from "@/common/ModIntegrity.js";

const ENTRY_KEYS = ["url", "name", "version", "integrity"];

export const MANIFEST_FILE = "mod.json";

/**
 * One mod in the list: where it came from, and the hash of every file the package consists of.
 */
export class ModLockEntry {

    /**
     * @param {string} url the mod's base URL, ending in "/"
     * @param {string} name
     * @param {string} version
     * @param {Map<string, string>} integrity package file name -> "sha256-..."
     */
    constructor(
        url,
        name,
        version,
        integrity,
    ) {
        this.url = url;
        this.name = name;
        this.version = version;
        this.integrity = integrity;
    }

    /**
     * The recorded hash of a package file; throws when the entry records none for it.
     * @param {string} file
     * @returns {string}
     */
    integrityOf(file) {
        const hash = this.integrity.get(file);
        if (hash === undefined) {
            throw new Error(`Mod "${this.name}" records no hash for ${file}`);
        }
        return hash;
    }

    /**
     * @returns {object}
     */
    toJSON() {
        return {
            url: this.url,
            name: this.name,
            version: this.version,
            integrity: Object.fromEntries(this.integrity),
        };
    }

    /**
     * @param {object} json
     * @returns {ModLockEntry}
     */
    static parse(json) {
        if (json === null || typeof json !== "object" || Array.isArray(json)) {
            throw new Error("A mod entry must be an object");
        }
        for (const key of Object.keys(json)) {
            if (!ENTRY_KEYS.includes(key)) {
                throw new Error(`Unknown key "${key}" in a mod entry`);
            }
        }
        if (typeof json.url !== "string" || !json.url.endsWith("/")) {
            throw new Error(`A mod's url must end in "/": ${JSON.stringify(json.url)}`);
        }
        if (!json.url.includes("://")) {
            throw new Error(`A mod's url needs a scheme: ${JSON.stringify(json.url)}`);
        }
        if (typeof json.name !== "string" || typeof json.version !== "string") {
            throw new Error(`Mod entry for ${json.url} is missing its name or version`);
        }
        if (json.integrity === null || typeof json.integrity !== "object") {
            throw new Error(`Mod "${json.name}" has no integrity map`);
        }
        const integrity = new Map();
        for (const [file, value] of Object.entries(json.integrity)) {
            integrityHex(value);
            integrity.set(file, value);
        }
        if (!integrity.has(MANIFEST_FILE)) {
            throw new Error(`Mod "${json.name}" records no hash for ${MANIFEST_FILE}`);
        }
        return new ModLockEntry(json.url, json.name, json.version, integrity);
    }
}

export class ModLockfile {

    /**
     * @param {ModLockEntry[]} mods in loadout order
     */
    constructor(mods) {
        this.mods = mods;
    }

    /**
     * @param {string} name
     * @returns {ModLockEntry|null}
     */
    find(name) {
        const found = this.mods.find(entry => entry.name === name);
        if (found === undefined) {
            return null;
        }
        return found;
    }

    /**
     * This list with every entry `built` also names replaced by `built`'s, each in its own position,
     * and every other `built` entry appended in its own order. Appending keeps the positional ids of
     * everything already pinned, so a build that ships a new base mod stays loadable.
     * @param {ModLockfile} built
     * @returns {ModLockfile}
     */
    withUpdated(built) {
        const mods = this.mods.map(entry => {
            const replacement = built.find(entry.name);
            if (replacement === null) {
                return entry;
            }
            return replacement;
        });
        const pinned = new Set(this.mods.map(entry => entry.name));
        for (const entry of built.mods) {
            if (!pinned.has(entry.name)) {
                mods.push(entry);
            }
        }
        return new ModLockfile(mods);
    }

    /**
     * @returns {object}
     */
    toJSON() {
        return {mods: this.mods.map(entry => entry.toJSON())};
    }

    /**
     * @param {object} json
     * @returns {ModLockfile}
     */
    static parse(json) {
        if (json === null || typeof json !== "object" || !Array.isArray(json.mods)) {
            throw new Error("A pinned loadout must hold a `mods` array");
        }
        const mods = json.mods.map(entry => ModLockEntry.parse(entry));
        const names = new Set();
        for (const entry of mods) {
            if (names.has(entry.name)) {
                throw new Error(`A pinned loadout lists "${entry.name}" twice`);
            }
            names.add(entry.name);
        }
        return new ModLockfile(mods);
    }
}
