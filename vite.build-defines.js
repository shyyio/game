import {execSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

// Names the built base mods in loadout order; publish-base-mods.js writes it.
export const ORDER_FILE = "order.json";

const ENTRY_FILE = "mod.js";

/**
 * The digest of every built base mod's bundle, in the order its order.json lists them. A client
 * build is stamped with these, so it can tell its own base mods from a server's third-party pins.
 * @param {string} distMods a directory publishBaseMods wrote
 * @returns {string[]} lowercase hex sha-256
 */
export function builtModHashes(distMods) {
    const orderPath = join(distMods, ORDER_FILE);
    if (!existsSync(orderPath)) {
        throw new Error(`${distMods} holds no built mods; run \`npm run mods:base\` first`);
    }
    const order = JSON.parse(readFileSync(orderPath, "utf8"));
    return order.map(dir => createHash("sha256").update(readFileSync(join(distMods, dir, ENTRY_FILE))).digest("hex"));
}

/**
 * @returns {{commit: string, date: string}} HEAD's commit hash and commit date (ISO 8601)
 */
export function gitBuildInfo() {
    const [commit, date] = execSync("git show -s --format=%H%n%cI HEAD").toString().trim().split("\n");
    return {commit, date};
}

/**
 * @returns {string} the version the package publishes
 */
export function packageVersion() {
    return JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
}
