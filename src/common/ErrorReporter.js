const MESSAGE_MAX_BYTES = 1024;
const STACK_MAX_BYTES = 8192;
const URL_MAX_BYTES = 500;

const MAX_FINGERPRINTS = 500;

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
 * Builds reportingserver's POST /report payloads and hands them to a transport.
 * Repeats of a fingerprint (message plus the first 3 stack lines) are dropped, so a crash loop
 * costs one request rather than one per throw.
 */
export class ErrorReporter {

    /**
     * @param {string} endpoint - reportingserver's ingest URL
     * @param {string} buildVersion - the git commit the reporting side symbolicates against
     * @param {() => string} urlProvider - the report's `url` field, read per report
     * @param {(endpoint: string, body: string) => Promise<*>} transport
     */
    constructor(
        endpoint,
        buildVersion,
        urlProvider,
        transport,
    ) {
        this._endpoint = endpoint;
        this._buildVersion = buildVersion;
        this._urlProvider = urlProvider;
        this._transport = transport;
        this._seenFingerprints = new Set();
    }

    /**
     * Reports `error`, formatting non-Error values via `fallbackPrefix`.
     * @param {unknown} error
     * @param {string} fallbackPrefix
     * @param {object} [extra]
     * @returns {Promise<void>}
     */
    reportError(error, fallbackPrefix, extra) {
        if (error instanceof Error) {
            return this.report(error.message || String(error), error.stack || error.message, extra);
        }
        const message = `${fallbackPrefix}: ${String(error)}`;
        return this.report(message, message, extra);
    }

    /**
     * @param {string} message
     * @param {string} stack
     * @param {object} [extra]
     * @returns {Promise<void>} resolves once the transport settled; a failed send is swallowed
     */
    report(message, stack, extra) {
        const fingerprint = `${message}\n${stack.split("\n").slice(0, 3).join("\n")}`;
        if (this._seenFingerprints.has(fingerprint)) {
            return Promise.resolve();
        }
        if (this._seenFingerprints.size >= MAX_FINGERPRINTS) {
            this._seenFingerprints.delete(this._seenFingerprints.values().next().value);
        }
        this._seenFingerprints.add(fingerprint);

        const body = {
            message: truncateUtf8(message, MESSAGE_MAX_BYTES),
            stack: truncateUtf8(stack, STACK_MAX_BYTES),
            buildVersion: this._buildVersion,
            url: truncateUtf8(this._urlProvider(), URL_MAX_BYTES),
        };
        if (extra !== undefined) {
            body.extra = extra;
        }

        try {
            return Promise.resolve(this._transport(this._endpoint, JSON.stringify(body))).then(() => {}, () => {});
        } catch (error) {
            return Promise.resolve();
        }
    }
}
