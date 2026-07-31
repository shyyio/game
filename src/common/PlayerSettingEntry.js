/**
 * Per-key player-setting config, collected at ModRegistry.freeze(). Never wired.
 */
export class PlayerSettingEntry {

    /**
     * @param {number} key
     * @param {boolean} clientWritable whether a SetPlayerSettingMessage may write the key;
     *     server-authoritative keys (progress, unlocks) stay false
     * @param {number} optionCount client writes must hold an integer in [0, optionCount);
     *     toggles hold 2
     */
    constructor(key, clientWritable, optionCount) {
        this.key = key;
        this.clientWritable = clientWritable;
        this.optionCount = optionCount;
    }
}

/**
 * Core entries (none yet); mods contribute theirs via their declaration's playerSettingEntries.
 * @type {PlayerSettingEntry[]}
 */
export const CORE_PLAYER_SETTING_ENTRIES = [];
