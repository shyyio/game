// Adds this game release to the example mod's registry listing. The example's source is this repo,
// so the entry carries the game version as both `version` and `toolchain`, at the commit the
// release tag names. It commits and pushes the listing in the registry checkout, whose CI validates
// it and publishes the package. `npm run deploy` runs this as its last step.
//
//   npm run add-release [-- --registry ../spup-mods --version 4.1.0 --commit <sha>]
//
// Every flag has a default: the sibling spup-mods checkout, this checkout's version, and the sha
// of its `v<version>` tag.

import {execFileSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {GAME_VERSION} from "../src/common/constants.js";
import {runStep, fail} from "./steps.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE_MOD = "pebble-generator";
const DEFAULT_REGISTRY = "../spup-mods";

/**
 * @param {string} left
 * @param {string} right
 * @returns {number} negative when left is older
 */
function compareVersions(left, right) {
    const leftParts = left.split(".").map(part => Number(part));
    const rightParts = right.split(".").map(part => Number(part));
    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] !== rightParts[index]) {
            return leftParts[index] - rightParts[index];
        }
    }
    return 0;
}

/**
 * Appends the release to a listing's versions; the listing is registry.json as parsed.
 * @param {object} listing
 * @param {string} version the game version
 * @param {string} commit the release tag's sha
 * @returns {void}
 */
export function addRelease(listing, version, commit) {
    const last = listing.versions[listing.versions.length - 1];
    if (compareVersions(version, last.version) <= 0) {
        throw new Error(`${listing.name} already lists ${last.version}, so ${version} cannot follow it`);
    }
    listing.versions.push({
        version,
        commit,
        toolchain: version,
        sdkVersion: Number(version.split(".")[0]),
    });
}

/**
 * @param {string} version
 * @returns {string} the sha the tag `v<version>` names in this checkout
 */
function resolveTag(version) {
    return execFileSync("git", ["rev-list", "-n", "1", `v${version}`], {cwd: ROOT, encoding: "utf8"}).trim();
}

function main() {
    const {values: args} = parseArgs({
        options: {
            "registry": {type: "string", default: DEFAULT_REGISTRY},
            "version": {type: "string", default: GAME_VERSION},
            "commit": {type: "string"},
        },
    });
    const listingPath = resolve(ROOT, args.registry, "mods", EXAMPLE_MOD, "registry.json");
    const listing = JSON.parse(readFileSync(listingPath, "utf8"));
    const commit = args.commit === undefined ? resolveTag(args.version) : args.commit;
    addRelease(listing, args.version, commit);
    writeFileSync(listingPath, `${JSON.stringify(listing, null, 4)}\n`);
    console.log(`${EXAMPLE_MOD} ${args.version} added at ${commit.slice(0, 8)} in ${join(args.registry, "mods", EXAMPLE_MOD, "registry.json")}`);
    const registry = resolve(ROOT, args.registry);
    const hint = `The listing is written; commit and push it in ${registry} and the registry's CI publishes it.`;
    runStep("stage the listing", "git", ["add", listingPath], {cwd: registry, hint});
    runStep("commit the listing", "git", ["commit", "-m", `Add ${EXAMPLE_MOD} ${args.version}`], {cwd: registry, hint});
    runStep("push the listing", "git", ["push"], {cwd: registry, hint});
    console.log("Pushed: the registry's CI builds and publishes the package.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        main();
    }
    catch (error) {
        fail("add-release", error);
    }
}
