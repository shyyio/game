// Step plumbing shared by the release and deploy scripts: every command runs as a named step, and a
// failure ends the run with one readable line and what to do about it, not a stack trace.

import {spawnSync} from "node:child_process";

/**
 * A failed step, carrying the way out.
 */
export class StepError extends Error {

    /**
     * @param {string} message
     * @param {string} [hint] - printed under the message
     */
    constructor(message, hint="") {
        super(message);
        this.hint = hint;
    }
}

/**
 * Numbers the steps as they start, so a failure is easy to place in the run.
 */
export class StepLog {

    /**
     * @param {number} total
     */
    constructor(total) {
        this.total = total;
        this.index = 0;
        this.label = "";
    }

    /**
     * @param {string} label
     * @returns {void}
     */
    begin(label) {
        this.index += 1;
        this.label = label;
        console.log(`\n[${this.index}/${this.total}] ${label}`);
    }
}

/**
 * Runs a command as `label`, failing the script on anything but a clean exit. The child's own output
 * goes straight to the terminal, so the thrown error only has to say which step ended the run.
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, hint?: string}} [options]
 * @returns {void}
 */
export function runStep(label, command, args, {cwd=process.cwd(), hint=""}={}) {
    const result = spawnSync(command, args, {cwd, stdio: "inherit"});
    const shown = `${command} ${args.join(" ")}`;
    if (result.error !== undefined) {
        throw new StepError(`${label}: could not run \`${shown}\` (${result.error.code})`, hint);
    }
    if (result.signal !== null) {
        throw new StepError(`${label}: \`${shown}\` was killed by ${result.signal}`, hint);
    }
    if (result.status !== 0) {
        throw new StepError(
            `${label}: \`${shown}\` exited ${result.status}; its own output is above this line`,
            hint,
        );
    }
}

/**
 * Ends the script on a failed step: the message, the hint, and nothing else. A stack only shows for
 * an unexpected error, where it is the useful part.
 * @param {string} script - the npm script the user ran
 * @param {Error} error
 * @returns {void}
 */
export function fail(script, error) {
    if (!(error instanceof StepError)) {
        console.error(`\nnpm run ${script} hit a bug in its own tooling:`);
        console.error(error);
        process.exit(1);
    }
    console.error(`\nnpm run ${script} stopped: ${error.message}`);
    if (error.hint !== "") {
        console.error(`\n${error.hint}`);
    }
    process.exit(1);
}
