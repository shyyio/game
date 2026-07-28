export const PLAYER_SETTING_RECORD = "PlayerSetting";

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

    /**
     * @returns {IterableIterator<[number, number]>} key→value pairs
     */
    entries() {
        return this._values.entries();
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
     * @param {number} key
     * @returns {number|undefined}
     */
    get(playerId, key) {
        const settings = this._byPlayer.get(playerId);
        if (settings === undefined) {
            return undefined;
        }
        return settings.get(key);
    }

    /**
     * @param {number} playerId
     * @returns {Object.<number, number>} a plain key→value snapshot for wire sync
     */
    snapshot(playerId) {
        const settings = this._byPlayer.get(playerId);
        if (settings === undefined) {
            return {};
        }
        return settings.snapshot();
    }

    /**
     * @returns {object} the PlayerSetting record table
     */
    serializeRecords() {
        const rows = [];
        for (const [playerId, settings] of this._byPlayer) {
            for (const [key, value] of settings.entries()) {
                rows.push({player_id: playerId, key, value});
            }
        }
        return {
            name: PLAYER_SETTING_RECORD,
            fields: [
                {name: "player_id", kind: "integer"},
                {name: "key", kind: "integer"},
                {name: "value", kind: "integer"},
            ],
            rows,
        };
    }

    /**
     * @param {object|undefined} table - the PlayerSetting record table; undefined clears
     * @returns {void}
     */
    deserializeRecords(table) {
        this._byPlayer.clear();
        if (table === undefined) {
            return;
        }
        for (const row of table.rows) {
            this.set(row.player_id, row.key, row.value);
        }
    }
}
