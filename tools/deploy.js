// One command from a committed main to live: builds every bundle, releases the npm packages, then
// pushes to `all` so every service redeploys off the same commit.
//
//   npm run deploy
//
// It restarts both game servers, dropping anyone mid-session.
//
// It does not bump the version, commit, or install deploy hooks. Bump the root package.json, commit,
// then run this. A change to deploy/post-receive* or deploy/*.service still has to be installed onto
// the host by hand — a push re-runs whatever hook is already there.

import {spawnSync} from "node:child_process";
import {resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {GAME_VERSION} from "../src/common/constants.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TAG = `v${GAME_VERSION}`;

// Local pre-flight: the hosts rebuild their own service in post-receive, but a build that breaks
// should break here rather than on the far side of a push.
const BUILDS = ["build", "build:server", "build:authserver", "build:reportingserver"];

const DEPLOY_REMOTES = ["ca1", "de1", "auth", "spup-reporting-ca1", "mirror", "pages"];

/**
 * Runs a command, failing the deploy on anything but a clean exit.
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {void}
 */
function run(command, args, cwd=ROOT) {
    const result = spawnSync(command, args, {cwd, stdio: "inherit"});
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed`);
    }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {{status: number, stdout: string}}
 */
function capture(command, args) {
    const result = spawnSync(command, args, {cwd: ROOT, encoding: "utf8"});
    return {status: result.status, stdout: result.stdout.trim()};
}

/**
 * Stops a deploy off a side branch: the hooks only act on main.
 * @returns {void}
 */
function assertOnMain() {
    const {stdout} = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (stdout !== "main") {
        throw new Error(`deploys go out from main, not ${stdout}`);
    }
}

/**
 * Stops the deploy while the tree still holds uncommitted work.
 * @returns {void}
 */
function assertCommitted() {
    const {stdout} = capture("git", ["status", "--porcelain"]);
    if (stdout !== "") {
        throw new Error(`the working tree has uncommitted changes:\n${stdout}`);
    }
}

/**
 * Keeps package.json's version and its tag on one commit: a tag left behind on older code would go
 * out naming this deploy something it is not.
 * @param {boolean} mustExist whether the release should have written it by now
 * @returns {void}
 */
function assertVersionTag(mustExist) {
    const {status, stdout} = capture("git", ["rev-list", "-n", "1", TAG]);
    if (status !== 0) {
        if (mustExist) {
            throw new Error(`the release did not tag ${TAG}`);
        }
        return;
    }
    const {stdout: head} = capture("git", ["rev-parse", "HEAD"]);
    if (stdout !== head) {
        throw new Error(`${TAG} is on ${stdout.slice(0, 8)}, not this commit — bump the version in package.json, or move the tag`);
    }
}

/**
 * Confirms every remote moved to the commit that was just pushed.
 * @param {string} head
 * @returns {void}
 */
function assertRemotesAt(head) {
    const behind = [];
    for (const remote of DEPLOY_REMOTES) {
        const {status, stdout} = capture("git", ["ls-remote", remote, "main"]);
        const [remoteHead] = stdout.split("\t");
        if (status !== 0 || remoteHead !== head) {
            behind.push(`${remote} ${remoteHead || "unreachable"}`);
        }
        else {
            console.log(`${remote} is at ${head.slice(0, 8)}`);
        }
    }
    if (behind.length > 0) {
        throw new Error(`these remotes are not on the deployed commit:\n${behind.join("\n")}`);
    }
}

assertOnMain();
assertCommitted();
assertVersionTag(false);

console.log(`deploying ${GAME_VERSION}`);
for (const script of BUILDS) {
    run("npm", ["run", script]);
}

// The release runs the tests and the staleness checks, publishes what is not on npm yet, and tags.
run("npm", ["run", "release"]);
assertVersionTag(true);

run("git", ["push", "all", "main", TAG]);

const {stdout: head} = capture("git", ["rev-parse", "main"]);
assertRemotesAt(head);
console.log(`${GAME_VERSION} is live — check https://ca1.spupgame.com/status and /mods/index.json`);
