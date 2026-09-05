// Loading a packaged mod in the browser: fetch its files, verify them against the hash the loadout
// records, evaluate the bundle, and call its factories. Two callers share this — a remote join
// (@/client/ModFetcher.js) and local play's own mod list (@/client/LocalLoadout.js) — so there is
// one place that decides what counts as a verified mod file.

import {ModPackage} from "@/common/ModPackage.js";
import {ModManifest, SDK_VERSION, MOD_PART_SIM, MOD_PART_CLIENT} from "@/common/ModManifest.js";
import {MANIFEST_FILE} from "@/common/ModLockfile.js";
import {formatIntegrity, integrityHex, contentName} from "@/common/ModIntegrity.js";
import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import * as sdk from "@/sdk/client.js";

const DB_NAME = "spup-mods";
const STORE_NAME = "files";
// Cache entries are keyed by content hash, so they are immutable and never need invalidating.
const DB_VERSION = 1;

/**
 * @param {Uint8Array} bytes
 * @returns {string} lowercase hex sha-256
 */
export function sha256Hex(bytes) {
    // Not crypto.subtle: it exists only in a secure context, so the dev server reached by LAN IP
    // over plain http has no digest at all. Two files per mod, on cache miss — native buys nothing.
    return bytesToHex(sha256(bytes));
}

/**
 * The browser-side store of already-downloaded mod files. Absent storage (private mode, a blocked
 * IndexedDB) only costs a re-download, so it degrades to no caching instead of failing the join.
 */
export class ModFileStore {

    /**
     * @param {IDBDatabase|null} db
     */
    constructor(db) {
        this._db = db;
    }

    /**
     * @returns {Promise<ModFileStore>}
     */
    static async open() {
        try {
            const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            return new ModFileStore(db);
        } catch {
            return new ModFileStore(null);
        }
    }

    /**
     * @param {string} name
     * @returns {Promise<Uint8Array|null>}
     */
    async get(name) {
        if (this._db === null) {
            return null;
        }
        const stored = await this._request(STORE_NAME, "readonly", store => store.get(name));
        if (stored === undefined) {
            return null;
        }
        return new Uint8Array(stored);
    }

    /**
     * @param {string} name
     * @param {Uint8Array} bytes
     * @returns {Promise<void>}
     */
    async put(name, bytes) {
        if (this._db === null) {
            return;
        }
        await this._request(STORE_NAME, "readwrite", store => store.put(bytes, name));
    }

    /**
     * @private
     * @param {string} storeName
     * @param {string} mode
     * @param {function(IDBObjectStore): IDBRequest} run
     * @returns {Promise<*>}
     */
    _request(storeName, mode, run) {
        return new Promise((resolve, reject) => {
            const request = run(this._db.transaction(storeName, mode).objectStore(storeName));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

/**
 * One mod file, from cache or from the network, hashed and compared against what it must be before
 * it is handed back. The cache is keyed by that same hash, so an entry can never answer for other
 * bytes.
 * @param {ModFileStore} store
 * @param {string} url where to download it
 * @param {string} cacheKey content-addressed name
 * @param {string} expectedHex lowercase hex sha-256 the bytes must have
 * @returns {Promise<Uint8Array>}
 */
export async function fetchVerifiedFile(store, url, cacheKey, expectedHex) {
    const cached = await store.get(cacheKey);
    if (cached !== null) {
        return cached;
    }
    const bytes = await fetchModFile(url);
    const hex = sha256Hex(bytes);
    if (hex !== expectedHex) {
        throw new Error(
            `${url} hashes to ${formatIntegrity(hex)}, but it must be ${formatIntegrity(expectedHex)}`,
        );
    }
    await store.put(cacheKey, bytes);
    return bytes;
}

/**
 * @param {string} url
 * @returns {Promise<Uint8Array>}
 */
async function fetchModFile(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not download ${url} (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

/**
 * Evaluates a bundle. Cross-origin `import()` cannot check integrity, so verified bytes are
 * imported from a blob instead of from the URL they came from.
 * @param {Uint8Array} bytes
 * @returns {Promise<object>} the bundle's factory exports
 */
export async function importBundle(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], {type: "text/javascript"}));
    try {
        return await import(/* @vite-ignore */ url);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Calls a bundle's factories. A sim part is evaluated only where a sim actually runs: local play
 * hosts one in the page, a remote join leaves it to the server.
 * @param {object} bundle the factory exports
 * @param {string[]} parts which factories the manifest declares
 * @param {boolean} withSim
 * @returns {ModPackage}
 */
export function instantiatePackage(bundle, parts, withSim) {
    let sim = null;
    if (withSim && parts.includes(MOD_PART_SIM)) {
        sim = bundle.createSim(sdk);
    }
    let client = null;
    if (parts.includes(MOD_PART_CLIENT)) {
        client = bundle.createClient(sdk);
    }
    return new ModPackage(bundle.createDeclaration(sdk), {sim, client});
}

/**
 * @param {ModManifest} manifest
 * @returns {void}
 */
function assertSdkVersion(manifest) {
    if (manifest.sdkVersion > SDK_VERSION) {
        throw new Error(`Mod "${manifest.name}" is built for a newer game; update your client to run it`);
    }
    if (manifest.sdkVersion !== SDK_VERSION) {
        throw new Error(
            `Mod "${manifest.name}" is built for game SDK ${manifest.sdkVersion}; this client speaks ${SDK_VERSION}`,
        );
    }
}

/**
 * Loads a mod a lockfile entry names: its manifest and its bundle, each verified against the hash
 * the entry records, and the manifest checked against what the entry says it is.
 * @param {ModFileStore} store
 * @param {ModLockEntry} entry
 * @param {boolean} withSim
 * @returns {Promise<ModPackage>}
 */
export async function loadModPackage(store, entry, withSim) {
    const manifestHex = integrityHex(entry.integrityOf(MANIFEST_FILE));
    const manifestBytes = await fetchVerifiedFile(
        store, `${entry.url}${MANIFEST_FILE}`, contentName(manifestHex, MANIFEST_FILE), manifestHex,
    );
    const manifest = ModManifest.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
    if (manifest.name !== entry.name || manifest.version !== entry.version) {
        throw new Error(
            `${entry.url} ships ${manifest.name} ${manifest.version}, but the loadout names it ` +
            `${entry.name} ${entry.version}`,
        );
    }
    assertSdkVersion(manifest);
    const entryHex = integrityHex(entry.integrityOf(manifest.entry));
    const bundleBytes = await fetchVerifiedFile(
        store, `${entry.url}${manifest.entry}`, contentName(entryHex, manifest.entry), entryHex,
    );
    return instantiatePackage(await importBundle(bundleBytes), manifest.parts, withSim);
}

