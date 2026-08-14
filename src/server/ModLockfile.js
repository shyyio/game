// The operator's mod config: an ordered, hash-pinned list of packaged mods. Order is loadout order
// (it assigns the positional typeIds/wireIds), so reordering is a save-breaking change. Nothing
// updates a pin implicitly — only the `mods` CLI rewrites this file.

import {readFileSync, writeFileSync} from "node:fs";
import {integrityHex} from "@/common/ModIntegrity.js";

const ENTRY_KEYS = ["url", "name", "version", "integrity"];

export const MANIFEST_FILE = "mod.json";

/**
 * One pinned mod: where it came from, and the hash of every file the package consists of.
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
     * The pinned hash of a package file; throws when the file is not pinned.
     * @param {string} file
     * @returns {string}
     */
    integrityOf(file) {
        const pinned = this.integrity.get(file);
        if (pinned === undefined) {
            throw new Error(`Mod "${this.name}" pins no hash for ${file}`);
        }
        return pinned;
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
            throw new Error("A mods.json entry must be an object");
        }
        for (const key of Object.keys(json)) {
            if (!ENTRY_KEYS.includes(key)) {
                throw new Error(`Unknown key "${key}" in a mods.json entry`);
            }
        }
        if (typeof json.url !== "string" || !json.url.endsWith("/")) {
            throw new Error(`A mod's url must end in "/": ${JSON.stringify(json.url)}`);
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
            throw new Error(`Mod "${json.name}" does not pin ${MANIFEST_FILE}`);
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
     * @returns {object}
     */
    toJSON() {
        return {mods: this.mods.map(entry => entry.toJSON())};
    }

    /**
     * @param {string} path
     * @returns {void}
     */
    write(path) {
        writeFileSync(path, `${JSON.stringify(this.toJSON(), null, 4)}\n`);
    }

    /**
     * @param {object} json
     * @returns {ModLockfile}
     */
    static parse(json) {
        if (json === null || typeof json !== "object" || !Array.isArray(json.mods)) {
            throw new Error("mods.json must hold a `mods` array");
        }
        const mods = json.mods.map(entry => ModLockEntry.parse(entry));
        const names = new Set();
        for (const entry of mods) {
            if (names.has(entry.name)) {
                throw new Error(`mods.json lists "${entry.name}" twice`);
            }
            names.add(entry.name);
        }
        return new ModLockfile(mods);
    }

    /**
     * @param {string} path
     * @returns {ModLockfile}
     */
    static read(path) {
        return ModLockfile.parse(JSON.parse(readFileSync(path, "utf8")));
    }
}
