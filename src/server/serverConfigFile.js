// The operator's server.json on disk. The model itself is @/common/ServerConfig.js, which the admin
// page shares to validate what it is about to save.

import {randomBytes} from "node:crypto";
import {chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {ServerConfig} from "@/common/ServerConfig.js";

const PATH_FIELDS = ["db", "metricsDb", "modsCache"];

const ADMIN_TOKEN_BYTES = 16;

// The config carries the admin token in the clear, so a new one is the owner's alone to read.
const OWNER_ONLY_MODE = 0o600;
const MODE_MASK = 0o777;

/**
 * @returns {string}
 */
export function generateAdminToken() {
    return randomBytes(ADMIN_TOKEN_BYTES).toString("hex");
}

/**
 * Reads the config file, treating a missing one as every default (the admin page's first save
 * creates it).
 * @param {string} path
 * @returns {ServerConfig}
 */
export function readServerConfigOrDefault(path) {
    if (!existsSync(path)) {
        return ServerConfig.parse({});
    }
    return ServerConfig.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Writes through a sibling temp file, so a crash mid-write never leaves half a config. The file
 * keeps whatever mode it already had; a new one is owner-only.
 * @param {ServerConfig} config
 * @param {string} path
 * @returns {void}
 */
export function writeServerConfig(config, path) {
    let mode = OWNER_ONLY_MODE;
    if (existsSync(path)) {
        mode = statSync(path).mode & MODE_MASK;
    }
    const temp = `${path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(config.toJSON(), null, 4)}\n`, {mode: OWNER_ONLY_MODE});
    chmodSync(temp, mode);
    renameSync(temp, path);
}

/**
 * The config with every path made absolute: a relative one counts from `baseDir`, the directory
 * the config file sits in, so a data directory moves as one.
 * @param {ServerConfig} config
 * @param {string} baseDir
 * @returns {ServerConfig}
 */
export function resolveConfigPaths(config, baseDir) {
    const json = config.toJSON();
    for (const key of PATH_FIELDS) {
        json[key] = resolve(baseDir, json[key]);
    }
    return ServerConfig.parse(json);
}
