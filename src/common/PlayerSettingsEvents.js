
import {LiveEvent} from "@/common/LiveEvent.js";

export const EVENT_PLAYER_SETTINGS_SYNC = 100;
export const EVENT_PLAYER_SETTINGS_UPDATE = 101;

export class PlayerSettingsSyncEvent extends LiveEvent {

    /**
     * @param {Object.<number, number>} values - all key→value pairs for this player
     */
    constructor(values) {
        super(EVENT_PLAYER_SETTINGS_SYNC, 0, 0);
        this.values = values;
    }
}

export class PlayerSettingUpdateEvent extends LiveEvent {

    /**
     * @param {number} key
     * @param {number} value
     */
    constructor(key, value) {
        super(EVENT_PLAYER_SETTINGS_UPDATE, 0, 0);
        this.key = key;
        this.value = value;
    }
}
