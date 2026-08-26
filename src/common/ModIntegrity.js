// Content hashes pin every packaged mod file. One algorithm (sha-256, lowercase hex) keeps the
// lockfile, the server's cache file names, and the client's verification a single format.

const INTEGRITY_PREFIX = "sha256-";

const INTEGRITY_PATTERN = /^sha256-[0-9a-f]{64}$/;

const HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * @param {string} hex
 * @returns {string} the pinned form, e.g. "sha256-ab12..."
 */
export function formatIntegrity(hex) {
    return `${INTEGRITY_PREFIX}${hex}`;
}

/**
 * The hex digest of a pinned integrity string; throws on anything else.
 * @param {string} integrity
 * @returns {string}
 */
export function integrityHex(integrity) {
    if (typeof integrity !== "string" || !INTEGRITY_PATTERN.test(integrity)) {
        throw new Error(`Malformed integrity: ${JSON.stringify(integrity)}`);
    }
    return integrity.slice(INTEGRITY_PREFIX.length);
}

/**
 * The content-addressed name a hashed file is cached and served under: its digest keeps the
 * original extension, so both node's loader and a browser's MIME sniffing stay happy.
 * @param {string} hex
 * @param {string} fileName the file's name in the package (for its extension)
 * @returns {string}
 */
export function contentName(hex, fileName) {
    const dot = fileName.lastIndexOf(".");
    if (dot === -1) {
        throw new Error(`Packaged file has no extension: ${fileName}`);
    }
    return `${hex}${fileName.slice(dot)}`;
}

/**
 * The digest a content-addressed name carries; throws when the name is not one.
 * @param {string} name as returned by contentName()
 * @returns {string} lowercase hex sha-256
 */
export function contentNameHex(name) {
    const dot = name.lastIndexOf(".");
    if (dot === -1) {
        throw new Error(`Content-addressed name has no extension: ${name}`);
    }
    const hex = name.slice(0, dot);
    if (!HEX_PATTERN.test(hex)) {
        throw new Error(`Not a content-addressed name: ${name}`);
    }
    return hex;
}
