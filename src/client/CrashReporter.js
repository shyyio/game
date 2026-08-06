import {BUILD_COMMIT} from "@/common/env.js";
import {REPORTING_URL} from "@/client/constants.js";

const MESSAGE_MAX_BYTES = 1024;
const STACK_MAX_BYTES = 8192;
const URL_MAX_BYTES = 500;

const MAX_FINGERPRINTS = 500;
const seenFingerprints = new Set();

/**
 * Truncates `text` to `maxBytes` UTF-8 bytes without splitting a multi-byte character.
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateUtf8(text, maxBytes) {
    if (new TextEncoder().encode(text).length <= maxBytes) {
        return text;
    }

    let low = 0;
    let high = text.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (new TextEncoder().encode(text.slice(0, mid)).length <= maxBytes) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    let truncated = text.slice(0, low);
    const lastCode = truncated.charCodeAt(truncated.length - 1);
    if (lastCode >= 0xD800 && lastCode <= 0xDBFF) {
        // Lone leading surrogate at the cut point; drop it so we don't split a surrogate pair.
        truncated = truncated.slice(0, -1);
    }
    return truncated;
}

/**
 * Reports `error`, formatting non-Error values via `fallbackPrefix`.
 * @param {unknown} error
 * @param {string} fallbackPrefix
 * @param {object} [extra]
 * @returns {void}
 */
function reportError(error, fallbackPrefix, extra) {
    if (error instanceof Error) {
        report(error.message || String(error), error.stack || error.message, extra);
    } else {
        const message = `${fallbackPrefix}: ${String(error)}`;
        report(message, message, extra);
    }
}

/**
 * @param {string} message
 * @param {string} stack
 * @param {object} [extra]
 * @returns {void}
 */
function report(message, stack, extra) {
    const fingerprint = `${message}\n${stack.split("\n").slice(0, 3).join("\n")}`;
    if (seenFingerprints.has(fingerprint)) {
        return;
    }
    if (seenFingerprints.size >= MAX_FINGERPRINTS) {
        seenFingerprints.delete(seenFingerprints.values().next().value);
    }
    seenFingerprints.add(fingerprint);

    const body = {
        message: truncateUtf8(message, MESSAGE_MAX_BYTES),
        stack: truncateUtf8(stack, STACK_MAX_BYTES),
        buildVersion: BUILD_COMMIT,
        url: truncateUtf8(location.href, URL_MAX_BYTES),
    };
    if (extra !== undefined) {
        body.extra = extra;
    }

    fetch(REPORTING_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
        keepalive: true,
    }).catch(() => {});
}

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
        reportError(event.error, "Uncaught error");
    });
    window.addEventListener("unhandledrejection", event => {
        reportError(event.reason, "Unhandled rejection");
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
    reportError(error, `Vue error (${info})`, {vueInfo: info});
}
