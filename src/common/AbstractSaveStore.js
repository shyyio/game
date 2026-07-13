import {NotImplementedError} from "@/common/error.js";

/**
 * Persists and restores a world snapshot (the shape {@link EcsSimEngine#serialize} produces): a list of
 * named components — each with typed field descriptors and one row per entity — plus a flat globals
 * map. Backends store this however suits their platform (SQLite tables on Node, a JSON blob in the
 * browser); both round-trip the identical snapshot object.
 * @abstract
 */
export class AbstractSaveStore {

    /**
     * Persists a snapshot, replacing any previously saved state.
     * @abstract
     * @param {object} snapshot
     * @returns {Promise<void>}
     */
    async save(snapshot) {
        throw new NotImplementedError();
    }

    /**
     * The most recently saved snapshot, or null when nothing is stored.
     * @abstract
     * @returns {Promise<object|null>}
     */
    async load() {
        throw new NotImplementedError();
    }
}
