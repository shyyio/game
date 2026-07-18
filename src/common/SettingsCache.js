/**
 * In-memory key→value game settings. Plain state, independent of the simulation backend.
 */
export class SettingsCache {

    constructor() {
        this._values = new Map();
    }

    /**
     * @param {number} key
     * @returns {number|undefined}
     */
    get(key) {
        return this._values.get(key);
    }

    /**
     * @param {number} key
     * @param {number} value
     * @returns {void}
     */
    set(key, value) {
        this._values.set(key, value);
    }

    /**
     * @returns {Object.<number, number>} a plain key→value snapshot for wire sync
     */
    snapshot() {
        const out = {};
        for (const [key, value] of this._values) {
            out[key] = value;
        }
        return out;
    }
}

/**
 * Per-player settings keyed by player id.
 */
export class PlayerSettingsCache {

    constructor() {
        // playerId -> SettingsCache
        this._byPlayer = new Map();
    }

    /**
     * @param {number} playerId
     * @param {number} key
     * @param {number} value
     * @returns {void}
     */
    set(playerId, key, value) {
        let settings = this._byPlayer.get(playerId);
        if (settings === undefined) {
            settings = new SettingsCache();
            this._byPlayer.set(playerId, settings);
        }
        settings.set(key, value);
    }

    /**
     * @param {number} playerId
     * @returns {Object.<number, number>} a plain key→value snapshot for wire sync
     */
    snapshot(playerId) {
        const settings = this._byPlayer.get(playerId);
        return settings === undefined ? {} : settings.snapshot();
    }
}
