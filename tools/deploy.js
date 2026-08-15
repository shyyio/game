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

import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {GAME_VERSION} from "../src/common/constants.js";
import {StepError, StepLog, runStep, fail} from "./steps.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TAG = `v${GAME_VERSION}`;

// Local pre-flight: the hosts rebuild their own service in post-receive, but a build that breaks
// should break here rather than on the far side of a push.
const BUILDS = ["build", "build:server", "build:authserver", "build:reportingserver"];

const DEPLOY_REMOTES = ["ca1", "de1", "auth", "spup-reporting-ca1", "mirror", "pages"];

// The pack scripts stamp GAME_VERSION into these three; mod-builder carries its own version.
const VERSIONED_PACKAGES = ["sdk", "game-server", "game-client"];

const NOTHING_PUSHED = "Nothing has been pushed, so the live servers are untouched.";

const RELEASE_HINT = [
    "The release printed its own reason above (it stops on a failing test, a stale package, or an",
    `npm refusal). ${NOTHING_PUSHED}`,
    "Fix it and re-run `npm run deploy`: the builds re-run and any package already on npm is skipped.",
].join("\n");

const PUSH_HINT = [
    "`git push all` writes to every deploy remote at once, so one rejected remote fails the push and",
    "the others may already have it. Look above for which remote refused, fix it (a diverged remote",
    "usually means someone pushed to it directly), then re-run `npm run deploy`.",
].join("\n");

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
        throw new StepError(
            `deploys go out from main, and this is ${stdout}`,
            "Merge into main and re-run: the post-receive hooks on the hosts only act on main.",
        );
    }
}

/**
 * Stops the deploy while the tree still holds uncommitted work.
 * @returns {void}
 */
function assertCommitted() {
    const {stdout} = capture("git", ["status", "--porcelain"]);
    if (stdout !== "") {
        throw new StepError(
            `the working tree has uncommitted changes:\n${stdout}`,
            "Deploys go out as a commit the hosts can check out. Commit (or stash) these, then re-run.",
        );
    }
}

/**
 * @param {string} dir a directory under packages/
 * @returns {object} its manifest
 */
function manifestOf(dir) {
    return JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));
}

/**
 * Catches a version bump whose package manifests were never re-packed and committed — the release
 * packs them itself and would otherwise only fail on the dirty tree, a full build later.
 * @returns {void}
 */
function assertVersionsSynced() {
    const stale = [];
    for (const dir of VERSIONED_PACKAGES) {
        const {version} = manifestOf(dir);
        if (version !== GAME_VERSION) {
            stale.push(`  packages/${dir} is ${version}`);
        }
    }
    if (stale.length > 0) {
        throw new StepError(
            `package.json says ${GAME_VERSION}, but these staged manifests are still behind:\n${stale.join("\n")}`,
            "Re-pack them and commit the result:\n"
            + "  npm run pack:sdk && npm run pack:server && npm run pack:client",
        );
    }
}

/**
 * Catches the one range no pack script writes. Its test would catch it too, but only after four
 * builds, four packs, and the whole suite.
 * @returns {void}
 */
function assertPeerRangeSynced() {
    const range = manifestOf("game-client").peerDependencies["@spup/game-server"];
    if (range !== `^${GAME_VERSION}`) {
        throw new StepError(
            `game-client still asks for a ${range} server, but this deploy is ${GAME_VERSION}`,
            "No pack script writes that range. Set it by hand and commit:\n"
            + `  packages/game-client/package.json  peerDependencies["@spup/game-server"]: "^${GAME_VERSION}"`,
        );
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
            throw new StepError(
                `the release finished without tagging ${TAG}`,
                `Tag it by hand (\`git tag ${TAG}\`) and re-run, or check why tools/release.js skipped it.`,
            );
        }
        return;
    }
    const {stdout: head} = capture("git", ["rev-parse", "HEAD"]);
    if (stdout !== head) {
        throw new StepError(
            `${TAG} already exists, on ${stdout.slice(0, 8)}, but HEAD is ${head.slice(0, 8)}`,
            `${GAME_VERSION} has gone out before. Either bump the version in package.json (then re-pack\n`
            + `and commit), or move the tag onto this commit with \`git tag -f ${TAG}\`.`,
        );
    }
}

/**
 * Confirms every remote moved to the commit that was just pushed.
 * @param {string} head
 * @returns {void}
 */
function assertRemotesAt(head) {
    const unreachable = [];
    const behind = [];
    for (const remote of DEPLOY_REMOTES) {
        const {status, stdout} = capture("git", ["ls-remote", remote, "main"]);
        const [remoteHead] = stdout.split("\t");
        if (status !== 0) {
            unreachable.push(`  ${remote}`);
        }
        else if (remoteHead !== head) {
            behind.push(`  ${remote} is on ${remoteHead.slice(0, 8)}`);
        }
        else {
            console.log(`  ${remote} is on ${head.slice(0, 8)}`);
        }
    }
    if (unreachable.length === 0 && behind.length === 0) {
        return;
    }
    const lines = [];
    if (behind.length > 0) {
        lines.push(`these remotes are not on ${head.slice(0, 8)}:\n${behind.join("\n")}`);
    }
    if (unreachable.length > 0) {
        lines.push(`these remotes did not answer:\n${unreachable.join("\n")}`);
    }
    throw new StepError(
        `the push landed, but ${lines.join("\n")}`,
        "The push itself succeeded, so the code may be live anyway. Check ssh access to the listed\n"
        + "remotes, then re-run `npm run deploy` — everything before the push is repeatable.",
    );
}

/**
 * @returns {void}
 */
function main() {
    // The four pre-flight checks count as one step, then the builds, the release, the tag check, the
    // push, and the remote check.
    const steps = new StepLog(BUILDS.length + 5);

    steps.begin("pre-flight checks");
    assertOnMain();
    assertCommitted();
    assertVersionsSynced();
    assertPeerRangeSynced();
    assertVersionTag(false);
    console.log(`deploying ${GAME_VERSION}`);

    for (const script of BUILDS) {
        steps.begin(`build: ${script}`);
        runStep(script, "npm", ["run", script], {
            cwd: ROOT,
            hint: `The build failed here rather than on a host. ${NOTHING_PUSHED}`,
        });
    }

    // The release runs the tests and the staleness checks, publishes what is not on npm yet, and tags.
    steps.begin("release to npm");
    runStep("release", "npm", ["run", "release"], {cwd: ROOT, hint: RELEASE_HINT});

    steps.begin(`check ${TAG} is on this commit`);
    assertVersionTag(true);

    steps.begin("push to every deploy remote");
    runStep("push", "git", ["push", "all", "main", TAG], {cwd: ROOT, hint: PUSH_HINT});

    steps.begin("check every remote took it");
    const {stdout: head} = capture("git", ["rev-parse", "main"]);
    assertRemotesAt(head);
    console.log(`\n${GAME_VERSION} is live — check https://ca1.spupgame.com/status and /mods/index.json`);
}

try {
    main();
}
catch (error) {
    fail("deploy", error);
}
