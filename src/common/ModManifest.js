// A packaged mod's `mod.json`: what the builder emits, and what the server CLI and the client
// loader parse before touching a bundle. Parsing throws on anything malformed or unknown — a bad
// manifest must fail at load time, never half-load a mod.

export const SDK_VERSION = 1;

export const MOD_PART_DECLARATION = "declaration";
export const MOD_PART_SIM = "sim";
export const MOD_PART_CLIENT = "client";

const MOD_PARTS = [MOD_PART_DECLARATION, MOD_PART_SIM, MOD_PART_CLIENT];

const NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const MANIFEST_KEYS = ["name", "version", "sdkVersion", "entry", "parts", "homepage"];

/**
 * Asserts a plain-object shape with no keys outside `allowed`.
 * @param {*} value
 * @param {string[]} allowed
 * @param {string} what for the error message
 * @returns {void}
 */
function assertObject(value, allowed, what) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${what} must be an object`);
    }
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
            throw new Error(`${what} has unknown key "${key}"`);
        }
    }
}

export class ModManifest {

    /**
     * @param {object} fields
     * @param {string} fields.name
     * @param {string} fields.version
     * @param {number} fields.sdkVersion
     * @param {string} fields.entry the bundle file, relative to the mod's base URL
     * @param {string[]} fields.parts which factories the bundle exports
     * @param {string|null} fields.homepage
     */
    constructor(
        {
            name,
            version,
            sdkVersion,
            entry,
            parts,
            homepage,
        },
    ) {
        this.name = name;
        this.version = version;
        this.sdkVersion = sdkVersion;
        this.entry = entry;
        this.parts = parts;
        this.homepage = homepage;
    }

    /**
     * Whether the bundle exports a factory for this part.
     * @param {string} part one of MOD_PART_*
     * @returns {boolean}
     */
    has(part) {
        return this.parts.includes(part);
    }

    /**
     * Every file the package consists of; the integrity map covers exactly these.
     * @returns {string[]}
     */
    get files() {
        return [this.entry];
    }

    /**
     * The manifest as it is written to mod.json.
     * @returns {object}
     */
    toJSON() {
        const json = {
            name: this.name,
            version: this.version,
            sdkVersion: this.sdkVersion,
            entry: this.entry,
            parts: this.parts,
        };
        if (this.homepage !== null) {
            json.homepage = this.homepage;
        }
        return json;
    }

    /**
     * Parses and validates a mod.json payload.
     * @param {object} json
     * @returns {ModManifest}
     */
    static parse(json) {
        assertObject(json, MANIFEST_KEYS, "manifest");
        const name = json.name;
        if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
            throw new Error(`Invalid mod name: ${JSON.stringify(name)}`);
        }
        const version = json.version;
        if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
            throw new Error(`Invalid version for mod "${name}": ${JSON.stringify(version)}`);
        }
        const sdkVersion = json.sdkVersion;
        if (!Number.isInteger(sdkVersion) || sdkVersion < 1) {
            throw new Error(`Invalid sdkVersion for mod "${name}": ${JSON.stringify(sdkVersion)}`);
        }
        const entry = json.entry;
        if (typeof entry !== "string" || !FILE_PATTERN.test(entry) || !entry.endsWith(".js")) {
            throw new Error(`Invalid entry for mod "${name}": ${JSON.stringify(entry)}`);
        }
        const parts = json.parts;
        if (!Array.isArray(parts) || !parts.includes(MOD_PART_DECLARATION)) {
            throw new Error(`Mod "${name}" must declare at least the ${MOD_PART_DECLARATION} part`);
        }
        for (const part of parts) {
            if (!MOD_PARTS.includes(part)) {
                throw new Error(`Mod "${name}" declares unknown part "${part}"`);
            }
        }
        if (new Set(parts).size !== parts.length) {
            throw new Error(`Mod "${name}" declares a part twice`);
        }
        const homepage = parseHomepage(json.homepage, name);
        return new ModManifest({name, version, sdkVersion, entry, parts, homepage});
    }
}

/**
 * @param {*} value
 * @param {string} name the mod's name, for error messages
 * @returns {string|null}
 */
function parseHomepage(value, name) {
    if (value === undefined) {
        return null;
    }
    if (typeof value !== "string" || !value.startsWith("https://")) {
        throw new Error(`Mod "${name}" has an invalid homepage: ${JSON.stringify(value)}`);
    }
    return value;
}
