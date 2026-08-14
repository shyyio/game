import {BUILD_COMMIT} from "@/common/env.js";
import {REPORTING_URL} from "@/common/constants.js";
import {ErrorReporter} from "@/common/ErrorReporter.js";

// A fatal report blocks the exit; a hung endpoint must not hold a crashed process open.
const REPORT_TIMEOUT_MS = 2000;

// Tags every report's extra, so the admin UI tells a game-server crash from a browser one.
const SERVICE = "game";

let reporter = null;

/**
 * @param {string} endpoint
 * @param {string} body
 * @returns {Promise<Response>}
 */
function post(endpoint, body) {
    return fetch(endpoint, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body,
        signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
}

/**
 * Installs process-level crash handlers that report to reportingserver and then exit non-zero,
 * leaving the restart to systemd. Unbundled runs (`npm run serve`, tests) report nothing: their
 * BUILD_COMMIT is "dev", which no sourcemap set matches anyway.
 * @param {string} origin - this server's canonical origin, sent as the report's `url`
 * @returns {void}
 */
export function installCrashReporter(origin) {
    if (BUILD_COMMIT === "dev") {
        return;
    }
    reporter = new ErrorReporter(REPORTING_URL, BUILD_COMMIT, () => origin, post);
    process.on("uncaughtException", error => {
        reportFatal(error, "Uncaught exception");
    });
    process.on("unhandledRejection", reason => {
        reportFatal(reason, "Unhandled rejection");
    });
}

/**
 * Logs and reports `error`, then exits non-zero once the report is sent or timed out.
 * @param {unknown} error
 * @param {string} fallbackPrefix - log line prefix, and the message for a non-Error throw
 * @param {object} [extra]
 * @returns {Promise<void>}
 */
export async function reportFatal(error, fallbackPrefix, extra) {
    console.error(`${fallbackPrefix}:`, error);
    if (reporter !== null) {
        await reporter.reportError(error, fallbackPrefix, {service: SERVICE, ...extra});
    }
    process.exit(1);
}

/**
 * Logs and reports `error` without exiting.
 * @param {unknown} error
 * @param {string} fallbackPrefix - log line prefix, and the message for a non-Error throw
 * @param {object} [extra]
 * @returns {void}
 */
export function reportError(error, fallbackPrefix, extra) {
    console.error(`${fallbackPrefix}:`, error);
    if (reporter === null) {
        return;
    }
    reporter.reportError(error, fallbackPrefix, {service: SERVICE, ...extra});
}
