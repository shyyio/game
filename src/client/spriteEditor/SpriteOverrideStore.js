// IndexedDB-backed store of artist-edited frames, keyed by frame name, holding a frame-sized PNG
// blob at atlas resolution. Lives in the main chunk so edits survive a reload without the editor.

const DB_NAME = "spup.sprites";
const DB_VERSION = 1;
const STORE_FRAMES = "frames";

export class SpriteOverrideStore {

    constructor() {
        /**
         * @type {Promise<IDBDatabase>|null}
         */
        this._db = null;
    }

    /**
     * @returns {Promise<IDBDatabase>}
     * @private
     */
    _open() {
        if (this._db === null) {
            this._db = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = () => {
                    request.result.createObjectStore(STORE_FRAMES);
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return this._db;
    }

    /**
     * @param {IDBTransactionMode} mode
     * @param {function(IDBObjectStore): IDBRequest} action
     * @returns {Promise<*>} the request's result
     * @private
     */
    async _request(mode, action) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const request = action(db.transaction(STORE_FRAMES, mode).objectStore(STORE_FRAMES));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * @param {string} frameName
     * @param {Blob} png
     * @returns {Promise<void>}
     */
    async put(frameName, png) {
        await this._request("readwrite", store => store.put(png, frameName));
    }

    /**
     * @param {string} frameName
     * @returns {Promise<void>}
     */
    async delete(frameName) {
        await this._request("readwrite", store => store.delete(frameName));
    }

    /**
     * @returns {Promise<void>}
     */
    async clear() {
        await this._request("readwrite", store => store.clear());
    }

    /**
     * @returns {Promise<string[]>}
     */
    async keys() {
        return this._request("readonly", store => store.getAllKeys());
    }

    /**
     * Every stored frame.
     * @returns {Promise<Map<string, Blob>>}
     */
    async entries() {
        const keys = await this.keys();
        const blobs = await this._request("readonly", store => store.getAll());
        const entries = new Map();
        for (let i = 0; i < keys.length; i++) {
            entries.set(keys[i], blobs[i]);
        }
        return entries;
    }

    /**
     * Paints every stored frame over the loaded atlases. A stored frame the loadout no longer
     * has (or whose size changed) is dropped.
     * @param {TextureRegistry} textureRegistry
     * @returns {Promise<number>} frames applied
     */
    async applyTo(textureRegistry) {
        const entries = await this.entries();
        let applied = 0;
        for (const [frameName, blob] of entries) {
            const bitmap = await createImageBitmap(blob);
            try {
                textureRegistry.patchFrame(frameName, bitmap);
                applied++;
            } catch (error) {
                console.warn(`Dropping stored sprite "${frameName}": ${error.message}`);
                await this.delete(frameName);
            } finally {
                bitmap.close();
            }
        }
        return applied;
    }
}
