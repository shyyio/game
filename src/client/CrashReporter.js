import {BUILD_COMMIT} from "@/common/env.js";
import {REPORTING_URL} from "@/common/constants.js";
import {ErrorReporter} from "@/common/ErrorReporter.js";

const reporter = new ErrorReporter(
    REPORTING_URL,
    BUILD_COMMIT,
    () => location.href,
    (endpoint, body) => fetch(endpoint, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body,
        // The report must survive the page teardown a crash often precedes.
        keepalive: true,
    }),
);

/**
 * Attaches window-level handlers that POST uncaught errors and unhandled promise rejections to reportingserver.
 * @returns {void}
 */
export function installCrashReporter() {
    window.addEventListener("error", event => {
        if (event.error === null || event.error === undefined) {
            // Cross-origin script errors carry no Error object (just "Script error."), no usable stack to symbolicate.
            return;
        }
        reporter.reportError(event.error, "Uncaught error");
    });
    window.addEventListener("unhandledrejection", event => {
        reporter.reportError(event.reason, "Unhandled rejection");
    });
}

/**
 * Reports an error Vue's own error handler caught (component render/lifecycle/watcher errors
 * never reach window's "error" event, since Vue handles them internally).
 * @param {unknown} error
 * @param {string} info Vue's error-source description, e.g. "render function".
 * @returns {void}
 */
export function reportVueError(error, info) {
    reporter.reportError(error, `Vue error (${info})`, {vueInfo: info});
}
