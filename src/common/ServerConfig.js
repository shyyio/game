// A game server's settings: what its flags used to carry, as one JSON file the admin page edits.
// Model only; reading and writing the operator's file lives in @/server/serverConfigFile.js.

import {DEFAULT_TICK_MS, ORIGIN_PATTERN, WORLD_SEED_MAX} from "@/common/constants.js";
import {ModLockfile} from "@/common/ModLockfile.js";

const MAX_PORT = 65535;
const DEFAULT_SAVE_MS = 60000;

/**
 * Every field, in the order the file and the form show them.
 * @enum
 */
export const SERVER_CONFIG_FIELDS = [
    "name", "origin", "authServer", "host", "port", "tickMs", "saveMs", "seed", "db", "metricsDb", "mods", "modsCache",
    "adminToken",
];

const DEFAULTS = {
    name: "Shy's Power-Up Factory",
    origin: "ws://localhost:27500",
    authServer: "https://auth.spupgame.com",
    host: "0.0.0.0",
    port: 27500,
    tickMs: DEFAULT_TICK_MS,
    saveMs: DEFAULT_SAVE_MS,
    // A fresh world draws a random seed, a loaded one keeps its own.
    seed: null,
    db: "world.sqlite3",
    metricsDb: "metrics.sqlite3",
    // The external mods this server runs on top of the loadout compiled into the build.
    mods: null,
    modsCache: "mods-cache",
    // What the admin page signs in with; the server generates one at boot when the file has none.
    adminToken: null,
};

/**
 * @param {object} json
 * @param {string} key
 * @returns {*} the value, or the default when the key is absent
 */
function valueOf(json, key) {
    if (json[key] === undefined) {
        return DEFAULTS[key];
    }
    return json[key];
}

/**
 * @param {object} json
 * @param {string} key
 * @returns {string}
 */
function text(json, key) {
    const value = valueOf(json, key);
    if (typeof value !== "string" || value === "") {
        throw new Error(`${key} must be a non-empty string`);
    }
    return value;
}

/**
 * @param {object} json
 * @param {string} key
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function integer(json, key, min, max) {
    const value = valueOf(json, key);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${key} must be an integer from ${min} to ${max}`);
    }
    return value;
}

export class ServerConfig {

    /**
     * @param {object} fields one value per SERVER_CONFIG_FIELDS entry, already validated
     */
    constructor(fields) {
        for (const key of SERVER_CONFIG_FIELDS) {
            this[key] = fields[key];
        }
    }

    /**
     * @returns {object}
     */
    toJSON() {
        const json = {};
        for (const key of SERVER_CONFIG_FIELDS) {
            json[key] = this[key];
        }
        return json;
    }

    /**
     * @returns {ModLockfile} the external mods, empty when the server runs none
     */
    get lockfile() {
        if (this.mods === null) {
            return new ModLockfile([]);
        }
        return ModLockfile.parse({mods: this.mods});
    }

    /**
     * @returns {object} what the admin page may see: everything but the token it signed in with
     */
    toPublicJSON() {
        const json = this.toJSON();
        delete json.adminToken;
        return json;
    }

    /**
     * This config with `values` on top: the flags an operator passed beside the file.
     * @param {object} values field -> value, only the fields to override
     * @returns {{config: ServerConfig, overridden: string[]}} which fields the overrides took
     */
    withOverrides(values) {
        const json = this.toJSON();
        const overridden = [];
        for (const key of SERVER_CONFIG_FIELDS) {
            if (values[key] === undefined) {
                continue;
            }
            json[key] = values[key];
            overridden.push(key);
        }
        return {config: ServerConfig.parse(json), overridden};
    }

    /**
     * @param {ServerConfig} other
     * @returns {string[]} the fields whose values differ, in field order
     */
    diff(other) {
        return SERVER_CONFIG_FIELDS.filter(key => JSON.stringify(this[key]) !== JSON.stringify(other[key]));
    }

    /**
     * A config file's contents; every absent field takes its default.
     * @param {object} json
     * @returns {ServerConfig}
     */
    static parse(json) {
        if (json === null || typeof json !== "object" || Array.isArray(json)) {
            throw new Error("A server config must be an object");
        }
        for (const key of Object.keys(json)) {
            if (!SERVER_CONFIG_FIELDS.includes(key)) {
                throw new Error(`Unknown key "${key}" in the server config`);
            }
        }
        const origin = text(json, "origin");
        if (!ORIGIN_PATTERN.test(origin)) {
            throw new Error(`origin must look like ws://host:port or wss://host:port, not ${JSON.stringify(origin)}`);
        }
        const authServer = text(json, "authServer");
        if (!authServer.startsWith("http://") && !authServer.startsWith("https://")) {
            throw new Error(`authServer must be an http(s) URL, not ${JSON.stringify(authServer)}`);
        }
        let seed = valueOf(json, "seed");
        if (seed !== null) {
            seed = integer(json, "seed", 0, WORLD_SEED_MAX);
        }
        let mods = valueOf(json, "mods");
        if (mods !== null) {
            if (!Array.isArray(mods)) {
                throw new Error("mods must be a list of mods");
            }
            mods = ModLockfile.parse({mods}).toJSON().mods;
        }
        let adminToken = valueOf(json, "adminToken");
        if (adminToken !== null) {
            adminToken = text(json, "adminToken");
        }
        return new ServerConfig({
            name: text(json, "name"),
            origin,
            authServer,
            host: text(json, "host"),
            port: integer(json, "port", 0, MAX_PORT),
            tickMs: integer(json, "tickMs", 1, Number.MAX_SAFE_INTEGER),
            saveMs: integer(json, "saveMs", 1, Number.MAX_SAFE_INTEGER),
            seed,
            db: text(json, "db"),
            metricsDb: text(json, "metricsDb"),
            mods,
            modsCache: text(json, "modsCache"),
            adminToken,
        });
    }
}
