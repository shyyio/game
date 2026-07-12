import {AbstractSaveStore} from "@/common/AbstractSaveStore.js";

// localStorage key holding the single-player save blob.
const SAVE_KEY = "pipesjs.save";

/**
 * Browser {@link AbstractSaveStore}: persists the snapshot as one JSON blob in localStorage.
 */
export class ClientSaveStore extends AbstractSaveStore {

    /**
     * @param {string} [key] - localStorage key
     */
    constructor(key=SAVE_KEY) {
        super();
        this.key = key;
    }

    /**
     * @param {object} snapshot
     * @returns {Promise<void>}
     */
    async save(snapshot) {
        localStorage.setItem(this.key, JSON.stringify(snapshot));
    }

    /**
     * @returns {Promise<object|null>}
     */
    async load() {
        const blob = localStorage.getItem(this.key);
        if (blob === null) {
            return null;
        }
        return JSON.parse(blob);
    }
}
