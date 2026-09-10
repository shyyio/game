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
    getValueByKey(key) {
        return this._values.get(key);
    }

    /**
     * @param {number} key
     * @param {number} value
     * @returns {void}
     */
    setValue(key, value) {
        this._values.set(key, value);
    }

    /**
     * @returns {Object.<number, number>} a plain key→value snapshot for wire sync
     */
    getSnapshot() {
        const out = {};
        for (const [key, value] of this._values) {
            out[key] = value;
        }
        return out;
    }

    /**
     * @returns {IterableIterator<[number, number]>} key→value pairs
     */
    getEntries() {
        return this._values.entries();
    }
}

/**
 * Per-player settings keyed by player ref.
 */
export class PlayerSettingsCache {

    constructor() {
        // playerRef -> SettingsCache
        this._byPlayer = new Map();
    }

    /**
     * @param {number} playerRef
     * @param {number} key
     * @param {number} value
     * @returns {void}
     */
    setPlayerValue(playerRef, key, value) {
        let settings = this._byPlayer.get(playerRef);
        if (settings === undefined) {
            settings = new SettingsCache();
            this._byPlayer.set(playerRef, settings);
        }
        settings.setValue(key, value);
    }

    /**
     * @param {number} playerRef
     * @param {number} key
     * @returns {number|undefined}
     */
    getPlayerValueByKey(playerRef, key) {
        const settings = this._byPlayer.get(playerRef);
        if (settings === undefined) {
            return undefined;
        }
        return settings.getValueByKey(key);
    }

    /**
     * @param {number} playerRef
     * @returns {Object.<number, number>} a plain key→value snapshot for wire sync
     */
    getPlayerSnapshot(playerRef) {
        const settings = this._byPlayer.get(playerRef);
        if (settings === undefined) {
            return {};
        }
        return settings.getSnapshot();
    }

    /**
     * @returns {object} the PlayerSetting record table
     */
    serializeRecords() {
        const rows = [];
        for (const [playerRef, settings] of this._byPlayer) {
            for (const [key, value] of settings.getEntries()) {
                rows.push({player_id: playerRef, key, value});
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
            this.setPlayerValue(row.player_id, row.key, row.value);
        }
    }
}
