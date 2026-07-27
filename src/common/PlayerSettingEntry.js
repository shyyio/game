/**
 * Per-key player-setting config, collected at ModRegistry.freeze(). Never wired.
 */
export class PlayerSettingEntry {

    /**
     * @param {number} key
     * @param {boolean} clientWritable whether a SetPlayerSettingMessage may write the key;
     *     server-authoritative keys (progress, unlocks) stay false
     */
    constructor(key, clientWritable) {
        this.key = key;
        this.clientWritable = clientWritable;
    }
}

/**
 * Core entries (none yet); mods contribute theirs via their declaration's playerSettingEntries.
 * @type {PlayerSettingEntry[]}
 */
export const CORE_PLAYER_SETTING_ENTRIES = [];
