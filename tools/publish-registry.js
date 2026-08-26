// Lists this release's base mods in the public registry. The registry builds every artifact from
// source at a pinned commit, so publishing a version is a commit to the registry repo naming this
// repo's release tag — no bundles are uploaded from here.
//
//   npm run mods:registry -- --repo ../spup-mods --check   # would it apply cleanly?
//   npm run mods:registry -- --repo ../spup-mods --push    # apply, commit, push
//
// `npm run deploy` runs both: --check in its pre-flight, --push after every service is live. The
// separation matters, because a failure here leaves the game running and only the listing behind.

import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";
import {GAME_VERSION} from "../src/common/constants.js";
import {SDK_VERSION} from "../src/common/ModManifest.js";
import {BASE_MOD_DIRS} from "../src/mods/loadout.js";
import {packageName} from "./build-mod.js";
import {StepError, fail} from "./steps.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Where a listed mod's registry manifest lives, relative to the registry repo.
const LISTING_DIR = "mods";
const LISTING_FILE = "registry.json";

// Cloned by hand, once; a deploy only reads and commits into it.
const DEFAULT_REPO = resolve(ROOT, "../spup-mods");

const CLONE_HINT = [
    "Clone the registry next to this repo, or point --repo at it:",
    "  git clone git@github.com:shyyio/spup-mods.git ../spup-mods",
    "Deploy without touching the listing with `npm run deploy -- --skip-registry`.",
].join("\n");

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {{status: number, stdout: string}}
 */
function git(cwd, args) {
    const result = spawnSync("git", args, {cwd, encoding: "utf8"});
    return {status: result.status, stdout: result.stdout.trim()};
}

/**
 * The commit a release tag names, which is what the registry builds each artifact from.
 * @param {string} version
 * @param {boolean} mustExist whether the tag has to be there already, rather than HEAD standing in
 * @returns {string}
 */
function taggedCommit(version, mustExist) {
    const tag = `v${version}`;
    const {status, stdout} = git(ROOT, ["rev-list", "-n", "1", tag]);
    if (status === 0) {
        return stdout;
    }
    if (mustExist) {
        throw new StepError(
            `this repo has no ${tag} tag, so there is no commit for the registry to build ${version} from`,
            "The release tags it. Run the deploy through `npm run deploy`, which releases before it publishes.",
        );
    }
    // A pre-flight check runs before the release tags anything, and the release tags HEAD.
    const {status: headStatus, stdout: head} = git(ROOT, ["rev-parse", "HEAD"]);
    if (headStatus !== 0) {
        throw new StepError(`could not read HEAD in ${ROOT}`, "Run this from a checkout with a commit on it.");
    }
    return head;
}

/**
 * The builder version the registry must build these mods with, so its artifacts are reproducible.
 * @returns {string}
 */
function toolchainVersion() {
    return JSON.parse(readFileSync(join(ROOT, "packages/mod-builder/package.json"), "utf8")).version;
}

/**
 * One mod's registry manifest, as the listing repo stores it.
 */
class Listing {

    /**
     * @param {string} path
     * @param {object} json
     */
    constructor(
        path,
        json,
    ) {
        this.path = path;
        this.json = json;
    }

    /**
     * @param {string} repo
     * @param {string} name
     * @returns {Listing}
     */
    static read(repo, name) {
        const path = join(repo, LISTING_DIR, name, LISTING_FILE);
        if (!existsSync(path)) {
            throw new StepError(
                `the registry has no listing for "${name}" (${path})`,
                "A mod is listed once, by hand, in a PR to the registry; only version bumps are automated.\n"
                + "Add the listing there, merge it, pull, then re-run.",
            );
        }
        const json = JSON.parse(readFileSync(path, "utf8"));
        if (!Array.isArray(json.versions)) {
            throw new StepError(`${path} has no \`versions\` array`, "Fix the listing by hand and re-run.");
        }
        return new Listing(path, json);
    }

    /**
     * Adds this release's version, or confirms the one already there says the same thing.
     * @param {string} version
     * @param {string} commit
     * @param {string} toolchain
     * @returns {boolean} whether anything changed
     */
    pin(version, commit, toolchain) {
        const existing = this.json.versions.find(entry => entry.version === version);
        if (existing === undefined) {
            this.json.versions.push({version, commit, toolchain, sdkVersion: SDK_VERSION});
            return true;
        }
        // A re-run after a half-finished deploy must be a no-op, but a version already published
        // from different source is a different mod under the same name.
        if (existing.commit !== commit || existing.toolchain !== toolchain) {
            throw new StepError(
                `the registry already publishes ${this.json.name} ${version}, pinned to `
                + `${existing.commit.slice(0, 8)} with toolchain ${existing.toolchain}, but this deploy is `
                + `${commit.slice(0, 8)} with toolchain ${toolchain}`,
                "A published version is immutable. Bump the version in package.json (then re-pack and\n"
                + "commit), or unpublish that version in the registry if it never went out.",
            );
        }
        return false;
    }

    /**
     * @returns {void}
     */
    write() {
        writeFileSync(this.path, `${JSON.stringify(this.json, null, 4)}\n`);
    }
}

/**
 * Pins this release's base mods into the registry checkout.
 * @param {object} options
 * @param {string} options.repo the registry checkout
 * @param {string} options.version
 * @param {boolean} options.write whether to write the listings, rather than only checking them
 * @returns {string[]} the mods whose listing this release adds a version to
 */
export function publishRegistry({repo, version, write}) {
    if (!existsSync(join(repo, LISTING_DIR))) {
        throw new StepError(`${repo} does not look like the mod registry (no ${LISTING_DIR}/ in it)`, CLONE_HINT);
    }
    const commit = taggedCommit(version, write);
    const toolchain = toolchainVersion();
    const changed = [];
    const listings = [];
    for (const dir of BASE_MOD_DIRS) {
        const listing = Listing.read(repo, packageName(dir));
        if (listing.pin(version, commit, toolchain)) {
            changed.push(packageName(dir));
            listings.push(listing);
        }
    }
    if (!write) {
        return changed;
    }
    for (const listing of listings) {
        listing.write();
    }
    return changed;
}

/**
 * Commits and pushes what publishRegistry wrote. Registry CI takes it from there: it checks out each
 * pinned commit, builds with the pinned toolchain, and publishes the artifacts and their hashes.
 * @param {string} repo
 * @param {string} version
 * @returns {void}
 */
function commitAndPush(repo, version) {
    const staged = git(repo, ["add", LISTING_DIR]);
    if (staged.status !== 0) {
        throw new StepError(`could not stage the registry's ${LISTING_DIR}/`, CLONE_HINT);
    }
    const committed = git(repo, ["commit", "-m", `base mods ${version}`]);
    if (committed.status !== 0) {
        throw new StepError(
            `the registry commit failed in ${repo}`,
            "Look at `git status` there: an unrelated dirty file or a mid-rebase state will do this.",
        );
    }
    const pushed = git(repo, ["push"]);
    if (pushed.status !== 0) {
        throw new StepError(
            `the registry push failed in ${repo}`,
            "The listing is committed locally, so nothing is lost. Pull/rebase there and push by hand;\n"
            + "the game itself is already live.",
        );
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const {values: args} = parseArgs({
        options: {
            "repo": {type: "string", default: process.env.SPUP_MODS_REPO || DEFAULT_REPO},
            "version": {type: "string", default: GAME_VERSION},
            "check": {type: "boolean", default: false},
            "push": {type: "boolean", default: false},
        },
    });
    try {
        const repo = resolve(args.repo);
        const changed = publishRegistry({repo, version: args.version, write: !args.check});
        if (changed.length === 0) {
            console.log(`the registry already lists every base mod at ${args.version}`);
        }
        else if (args.check) {
            console.log(`${args.version} would be listed for: ${changed.join(", ")}`);
        }
        else {
            console.log(`${args.version} listed for: ${changed.join(", ")}`);
            if (args.push) {
                commitAndPush(repo, args.version);
                console.log(`pushed to the registry; its CI builds and publishes the artifacts`);
            }
        }
    }
    catch (error) {
        fail("mods:registry", error);
    }
}
