// The operator's mod CLI: resolve a package into a pinned lockfile entry, review an update before
// taking it, and re-check the local cache. Nothing here runs implicitly — a server only ever loads
// what this tool wrote.
//
//   node src/server/modsCli.js list
//   node src/server/modsCli.js add https://mods.spupgame.com/logistics/2.1.0/
//   node src/server/modsCli.js update logistics --url https://mods.spupgame.com/logistics/2.2.0/ --yes
//   node src/server/modsCli.js verify

import {parseArgs} from "node:util";
import {existsSync} from "node:fs";
import {ModLockfile} from "@/server/ModLockfile.js";
import {ModCache, resolvePackage} from "@/server/ModCache.js";
import {ModCatalog, DEFAULT_REGISTRY_URL} from "@/server/ModCatalog.js";

const {values: args, positionals} = parseArgs({
    allowPositionals: true,
    options: {
        "mods": {type: "string", default: "mods.json"},
        "mods-cache": {type: "string", default: "mods-cache"},
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
    "options: --mods <mods.json> --mods-cache <dir> --registry <index.json url>",
].join("\n");

/**
 * Reads the lockfile, treating a missing file as an empty one (the first `add` creates it).
 * @param {string} path
 * @returns {ModLockfile}
 */
function readLockfile(path) {
    if (!existsSync(path)) {
        return new ModLockfile([]);
    }
    return ModLockfile.read(path);
}

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
        console.log(`${args["mods"]} pins no mods`);
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
    lockfile.write(args["mods"]);
    printEntry(entry);
    console.log(`Pinned in ${args["mods"]}`);
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
        throw new Error(`"${name}" is not pinned in ${args["mods"]}`);
    }
    const resolved = await resolvePackage(await updateUrlFor(existing, name));
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
    lockfile.write(args["mods"]);
    console.log(`Updated ${args["mods"]}`);
}

/**
 * @param {ModLockfile} lockfile
 * @returns {void}
 */
function verify(lockfile) {
    const problems = new ModCache(args["mods-cache"]).verify(lockfile);
    if (problems.length === 0) {
        console.log(`Cache matches ${args["mods"]}`);
        return;
    }
    for (const problem of problems) {
        console.error(problem);
    }
    process.exitCode = 1;
}

const [verb, target] = positionals;
const lockfile = readLockfile(args["mods"]);
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
    } else {
        console.error(USAGE);
        process.exitCode = 1;
    }
} catch (error) {
    // A stack trace helps nobody here: every throw above is a message written for the operator.
    console.error(error.message);
    process.exitCode = 1;
}
