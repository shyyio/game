import {test} from "node:test";
import assert from "node:assert/strict";
import {registryModHashes, unverifiedMods} from "@/client/ModVerification.js";

const MARKET_HASH = "a1".repeat(32);
const PEBBLES_HASH = "b2".repeat(32);
const ROGUE_HASH = "c3".repeat(32);

/**
 * @param {string} name
 * @param {object[]} versions
 * @returns {object} a listing as the registry index publishes it
 */
function listing(name, versions) {
    return {name, versions};
}

/**
 * @param {string} version
 * @param {string|null} hash the mod.js digest, or null for a version publishing no artifacts
 * @returns {object}
 */
function published(version, hash) {
    if (hash === null) {
        return {version};
    }
    return {version, artifacts: {"mod.json": `sha256-${"ff".repeat(32)}`, "mod.js": `sha256-${hash}`}};
}

/**
 * @param {string} name
 * @param {string} hash
 * @returns {object} an external entry of the mod list a server serves
 */
function listed(name, hash) {
    return {name, url: `https://mods.example.com/${name}/1.0.0/`, integrity: `sha256-${hash}`};
}

test("registry hashes cover every published version of every listed mod", () => {
    const hashes = registryModHashes([
        listing("market", [published("1.0.0", MARKET_HASH)]),
        listing("pebble-generator", [published("1.0.0", PEBBLES_HASH)]),
    ]);
    assert.deepEqual(Array.from(hashes).sort(), [MARKET_HASH, PEBBLES_HASH].sort());
});

test("a listed version publishing no artifacts contributes no hash", () => {
    const hashes = registryModHashes([listing("market", [published("1.0.0", null), published("1.1.0", MARKET_HASH)])]);
    assert.deepEqual(Array.from(hashes), [MARKET_HASH]);
});

test("a mod whose bundle the registry does not publish is unverified", () => {
    const approved = new Set([MARKET_HASH]);
    const mods = [listed("market", MARKET_HASH), listed("rogue", ROGUE_HASH)];
    assert.deepEqual(unverifiedMods(mods, approved), ["rogue"]);
});

test("nothing is unverified when the registry publishes every bundle the server names", () => {
    const approved = new Set([MARKET_HASH, PEBBLES_HASH]);
    const mods = [listed("market", MARKET_HASH), listed("pebble-generator", PEBBLES_HASH)];
    assert.deepEqual(unverifiedMods(mods, approved), []);
});
