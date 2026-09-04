// The operator's mod CLI over the pins in server.json: resolve a package into a pinned entry, review
// an update before taking it, re-check the local cache, and re-pin the base mods a build ships. The
// admin page does the same by checkbox; this is for scripts and deploys.
//
//   node src/server/modsCli.js list
//   node src/server/modsCli.js add https://mods.spupgame.com/logistics/2.1.0/
//   node src/server/modsCli.js update logistics --url https://mods.spupgame.com/logistics/2.2.0/ --yes
//   node src/server/modsCli.js verify
//   node src/server/modsCli.js sync-base --dist-mods build/mods

import {dirname, resolve} from "node:path";
import {parseArgs} from "node:util";
import {pinBuiltMods} from "@/server/builtMods.js";
import {ServerConfig} from "@/common/ServerConfig.js";
import {readServerConfigOrDefault, resolveConfigPaths, writeServerConfig} from "@/server/serverConfigFile.js";
import {ModCache, resolvePackage} from "@/server/ModCache.js";
import {ModCatalog, DEFAULT_REGISTRY_URL} from "@/server/ModCatalog.js";

const {values: args, positionals} = parseArgs({
    allowPositionals: true,
    options: {
        "config": {type: "string", default: "server.json"},
        "dist-mods": {type: "string"},
        "url": {type: "string"},
        "registry": {type: "string", default: DEFAULT_REGISTRY_URL},
        "replace": {type: "boolean", default: false},
        "yes": {type: "boolean", default: false},
    },
});

const USAGE = [
    "usage:",
    "  mods list",
    "  mods add <name>[@<version>] | <url> [--replace]",
    "  mods update <name> [--url <url>] --yes",
    "  mods verify",
    "  mods sync-base --dist-mods <dir>",
    "options: --config <server.json> --registry <index.json url>",
].join("\n");

/**
 * The package URL a target names: a URL is used as given, a bare name resolves through the
 * registry's published catalog.
 * @param {string} target
 * @returns {Promise<string>}
 */
async function packageUrlFor(target) {
    if (target.includes("://")) {
        return target;
    }
    const catalog = await ModCatalog.fetch(args["registry"]);
    const {entry, version} = catalog.resolve(target);
    console.log(`${entry.name} ${version.version} — ${entry.description}`);
    return version.url;
}

/**
 * @param {ModLockEntry} entry
 * @returns {void}
 */
function printEntry(entry) {
    console.log(`${entry.name} ${entry.version}  ${entry.url}`);
    for (const [file, integrity] of entry.integrity) {
        console.log(`  ${file}  ${integrity}`);
    }
}

/**
 * @param {ModLockfile} lockfile
 * @returns {void}
 */
function list(lockfile) {
    if (lockfile.mods.length === 0) {
        console.log(`${args["config"]} pins no mods`);
        return;
    }
    for (const [index, entry] of lockfile.mods.entries()) {
        console.log(`${index}. ${entry.name} ${entry.version}  ${entry.url}`);
    }
}

/**
 * @param {ModLockfile} lockfile
 * @param {string} target a package URL, or a registry name (optionally `name@version`)
 * @returns {Promise<void>}
 */
async function add(lockfile, target) {
    if (config.mods === null) {
        throw new Error(
            `${args["config"]} pins no mods, so the server runs the loadout built into it; pinning one ` +
            "mod here would replace that whole loadout. Run `sync-base --dist-mods <dir>` first.",
        );
    }
    const entry = await resolvePackage(await packageUrlFor(target));
    const existing = lockfile.find(entry.name);
    if (existing !== null && !args["replace"]) {
        throw new Error(
            `"${entry.name}" is already pinned at ${existing.version}; use \`update\` to change it, ` +
            "or --replace to overwrite the pin in place",
        );
    }
    if (existing === null) {
        // Appending keeps every already-pinned mod's positional ids, so existing saves stay loadable.
        lockfile.mods.push(entry);
    } else {
        lockfile.mods[lockfile.mods.indexOf(existing)] = entry;
    }
    writePins(lockfile);
    printEntry(entry);
    console.log(`Pinned in ${args["config"]}`);
}

/**
 * Where an update re-resolves from: an explicit --url, the registry's newest version for a listed
 * mod, or the pinned URL itself for an unlisted one (whose author republishes in place).
 * @param {ModLockEntry} existing
 * @param {string} name
 * @returns {Promise<string>}
 */
async function updateUrlFor(existing, name) {
    if (args["url"] !== undefined) {
        return args["url"];
    }
    try {
        return await packageUrlFor(name);
    } catch (error) {
        console.log(`${error.message}; re-checking ${existing.url}`);
        return existing.url;
    }
}

/**
 * @param {ModLockfile} lockfile
 * @param {string} name
 * @returns {Promise<void>}
 */
async function update(lockfile, name) {
    const existing = lockfile.find(name);
    if (existing === null) {
        throw new Error(`"${name}" is not pinned in ${args["config"]}`);
    }
    const url = await updateUrlFor(existing, name);
    const resolved = await resolvePackage(url);
    if (resolved.name !== name) {
        throw new Error(`${url} ships "${resolved.name}", not "${name}"`);
    }
    console.log(`${name}: ${existing.version} -> ${resolved.version}`);
    for (const [file, integrity] of resolved.integrity) {
        const before = existing.integrity.get(file);
        if (before === integrity) {
            continue;
        }
        const was = before === undefined ? "(absent)" : before;
        console.log(`  ${file}\n    was ${was}\n    now ${integrity}`);
    }
    if (!args["yes"]) {
        console.log("Nothing written. Re-run with --yes to take this update.");
        process.exitCode = 1;
        return;
    }
    lockfile.mods[lockfile.mods.indexOf(existing)] = resolved;
    writePins(lockfile);
    console.log(`Updated ${args["config"]}`);
}

/**
 * @param {ModLockfile} lockfile
 * @returns {void}
 */
function verify(lockfile) {
    const cacheDir = resolveConfigPaths(config, dirname(resolve(args["config"]))).modsCache;
    const problems = new ModCache(cacheDir).verify(lockfile);
    if (problems.length === 0) {
        console.log(`${cacheDir} matches ${args["config"]}`);
        return;
    }
    console.error(`${cacheDir} does not match ${args["config"]}:`);
    for (const problem of problems) {
        console.error(problem);
    }
    process.exitCode = 1;
}

/**
 * Pins the base mods a build ships, read in the order its order.json lists them: a config that
 * already pins keeps every position and every other mod and takes any new base mod at the end, one
 * that pins nothing starts as the full base list.
 * @param {ModLockfile} lockfile
 * @returns {Promise<void>}
 */
async function syncBase(lockfile) {
    const distMods = args["dist-mods"];
    if (distMods === undefined) {
        throw new Error("sync-base needs --dist-mods <dir>");
    }
    const built = await pinBuiltMods(distMods);
    if (built === null) {
        throw new Error(`${distMods} holds no built mods`);
    }
    let synced = built;
    if (lockfile.mods.length > 0) {
        synced = lockfile.withUpdated(built);
    }
    writePins(synced);
    console.log(`${args["config"]}: ${synced.mods.length} mods pinned, ${built.mods.length} base mods from ${distMods}`);
}

/**
 * Writes the pins back into the config, leaving every other setting as it was.
 * @param {ModLockfile} lockfile
 * @returns {void}
 */
function writePins(lockfile) {
    const json = config.toJSON();
    json.mods = lockfile.toJSON().mods;
    writeServerConfig(ServerConfig.parse(json), args["config"]);
}

const [verb, target] = positionals;
const config = readServerConfigOrDefault(args["config"]);
const lockfile = config.lockfile;
try {
    if (verb === "list") {
        list(lockfile);
    } else if (verb === "add") {
        if (target === undefined) {
            throw new Error("add needs a mod name or package url");
        }
        await add(lockfile, target);
    } else if (verb === "update") {
        if (target === undefined) {
            throw new Error("update needs a mod name");
        }
        await update(lockfile, target);
    } else if (verb === "verify") {
        verify(lockfile);
    } else if (verb === "sync-base") {
        await syncBase(lockfile);
    } else {
        console.error(USAGE);
        process.exitCode = 1;
    }
} catch (error) {
    // A stack trace helps nobody here: every throw above is a message written for the operator.
    console.error(error.message);
    process.exitCode = 1;
}
