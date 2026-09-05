// One command from a committed main to live: builds every bundle, runs the tests, tags, then
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
import {StepError, StepLog, runStep, fail} from "./steps.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TAG = `v${GAME_VERSION}`;

// Local pre-flight: the hosts rebuild their own service in post-receive, but a build that breaks
// should break here rather than on the far side of a push.
const BUILDS = ["build", "build:server", "build:authserver", "build:reportingserver"];

const DEPLOY_REMOTES = ["ca1", "de1", "auth", "spup-reporting-ca1", "mirror", "pages"];

const NOTHING_PUSHED = "Nothing has been pushed, so the live servers are untouched.";

// The mod checks reach src/mods, so they need the @/ alias hook the npm scripts pass.
const NODE_WITH_LOADER = ["--import", "./src/nodeservice/loader.js"];

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
 * Keeps package.json's version and its tag on one commit: a tag left behind on older code would go
 * out naming this deploy something it is not.
 * @returns {void}
 */
function assertVersionTag() {
    const {status, stdout} = capture("git", ["rev-list", "-n", "1", TAG]);
    if (status !== 0) {
        return;
    }
    const {stdout: head} = capture("git", ["rev-parse", "HEAD"]);
    if (stdout !== head) {
        throw new StepError(
            `${TAG} already exists, on ${stdout.slice(0, 8)}, but HEAD is ${head.slice(0, 8)}`,
            `${GAME_VERSION} has gone out before. Either bump the version in package.json and commit,\n`
            + `or move the tag onto this commit with \`git tag -f ${TAG}\`.`,
        );
    }
}

/**
 * Tags this commit, so a release is nameable after it has gone out.
 * @returns {void}
 */
function tagVersion() {
    if (capture("git", ["tag", "--list", TAG]).stdout !== "") {
        console.log(`${TAG} is already on this commit`);
        return;
    }
    runStep(`tag ${TAG}`, "git", ["tag", TAG], {cwd: ROOT, hint: NOTHING_PUSHED});
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
 * Catches a base mod that no longer builds as a package or reaches outside the SDK, before anything
 * is built or pushed.
 * @returns {void}
 */
function assertModsBuildable() {
    runStep("mod checks", "node", [...NODE_WITH_LOADER, "tools/check-base-mods.js"], {
        cwd: ROOT,
        hint: `A base mod reaches outside the SDK, or no longer builds. ${NOTHING_PUSHED}`,
    });
}

/**
 * @returns {void}
 */
function main() {
    // The pre-flight checks count as one step, then the builds, the tests, the tag, the push, and
    // the remote check.
    const steps = new StepLog(BUILDS.length + 5);

    steps.begin("pre-flight checks");
    assertOnMain();
    assertCommitted();
    assertVersionTag();
    assertModsBuildable();
    console.log(`deploying ${GAME_VERSION}`);

    for (const script of BUILDS) {
        steps.begin(`build: ${script}`);
        runStep(script, "npm", ["run", script], {
            cwd: ROOT,
            hint: `The build failed here rather than on a host. ${NOTHING_PUSHED}`,
        });
    }

    steps.begin("run the tests");
    runStep("tests", "npm", ["test"], {
        cwd: ROOT,
        hint: `The failing test is named above. ${NOTHING_PUSHED}`,
    });

    steps.begin(`tag ${TAG}`);
    tagVersion();

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
