
import {LiveEvent} from "@/common/LiveEvent.js";

export const EVENT_GAME_SETTINGS_SYNC = 102;
export const EVENT_GAME_SETTINGS_UPDATE = 103;

export class GameSettingsSyncEvent extends LiveEvent {

    /**
     * @param {Object.<number, number>} values - all key→value pairs
     */
    constructor(values) {
        super(EVENT_GAME_SETTINGS_SYNC, 0, 0);
        this.values = values;
    }
}

export class GameSettingsUpdateEvent extends LiveEvent {

    /**
     * @param {number} key
     * @param {number} value
     */
    constructor(key, value) {
        super(EVENT_GAME_SETTINGS_UPDATE, 0, 0);
        this.key = key;
        this.value = value;
    }
}
