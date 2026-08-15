// Fetches a server's loadout before joining it: the mod index, then one bundle per mod, verified
// against the content hash it is served under and evaluated through the factory interface. A mod's
// art is inlined in its bundle, so there is nothing else to fetch.
//
// The client ships no game content of its own in remote mode — the server's pin list is the
// loadout, which is also what keeps the positional wire ids in sync.

import {ModPackage} from "@/common/ModPackage.js";
import {SDK_VERSION, MOD_PART_CLIENT} from "@/common/ModManifest.js";
import {httpOriginFor} from "@/common/util.js";
import * as sdk from "@/sdk/client.js";

const DB_NAME = "spup-mods";
const STORE_NAME = "files";
// Cache entries are keyed by content hash, so they are immutable and never need invalidating.
const DB_VERSION = 1;

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<string>} lowercase hex sha-256
 */
async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The browser-side store of already-downloaded mod files. Absent storage (private mode, a blocked
 * IndexedDB) only costs a re-download, so it degrades to no caching instead of failing the join.
 */
class ModFileStore {

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
 * A mod file, from cache or from the server, verified against the hash it is named after.
 * @param {string} origin
 * @param {ModFileStore} store
 * @param {string} name content-addressed file name
 * @returns {Promise<Uint8Array>}
 */
async function fetchFile(origin, store, name) {
    const cached = await store.get(name);
    if (cached !== null) {
        return cached;
    }
    const response = await fetch(`${origin}/mods/${name}`);
    if (!response.ok) {
        throw new Error(`Could not download mod file ${name} (${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hex = await sha256Hex(bytes);
    if (!name.startsWith(hex)) {
        throw new Error(`Mod file ${name} does not match its content hash`);
    }
    await store.put(name, bytes);
    return bytes;
}

/**
 * Evaluates a bundle. Cross-origin `import()` cannot check integrity, so the verified bytes are
 * imported from a blob instead of from the server's URL.
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
 * The mods a server runs, as ModPackages in the server's order.
 * @param {string} serverUrl the websocket URL being joined
 * @returns {Promise<ModPackage[]>}
 */
export async function fetchModLoadout(serverUrl) {
    const origin = httpOriginFor(serverUrl);
    const response = await fetch(`${origin}/mods/index.json`);
    if (!response.ok) {
        throw new Error(
            `This server does not serve its mod list (${response.status}); it needs a build that runs a pinned loadout`,
        );
    }
    const index = await response.json();
    if (index.sdkVersion > SDK_VERSION) {
        throw new Error("This server runs mods built for a newer game; update your client to join it");
    }
    if (index.sdkVersion !== SDK_VERSION) {
        throw new Error(`This server runs mods built for game SDK ${index.sdkVersion}; this client speaks ${SDK_VERSION}`);
    }

    // Downloaded together — a first join is one round trip per mod otherwise — but evaluated in the
    // server's order, which is what assigns the positional ids.
    const store = await ModFileStore.open();
    const sources = await Promise.all(index.mods.map(mod => fetchFile(origin, store, mod.entry)));
    const packages = [];
    for (const [position, mod] of index.mods.entries()) {
        const bundle = await importBundle(sources[position]);
        // Remote mode never hosts a sim, so a mod's sim part stays unevaluated here.
        const client = mod.parts.includes(MOD_PART_CLIENT) ? bundle.createClient(sdk) : null;
        packages.push(new ModPackage(bundle.createDeclaration(sdk), {client}));
    }
    return packages;
}
