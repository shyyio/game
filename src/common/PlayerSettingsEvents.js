import {LiveEvent} from "@/common/LiveEvent.js";

export const EVENT_PLAYER_SETTINGS_SYNC = 100;
export const EVENT_PLAYER_SETTINGS_UPDATE = 101;

export class PlayerSettingsSyncEvent extends LiveEvent {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
        chunk: "string",
        values: "map<int32,int32>",
    };

    /**
     * @param {Object.<number, number>} values key->value pairs for this player
     */
    constructor(values) {
        super(EVENT_PLAYER_SETTINGS_SYNC, 0, 0);
        this.values = values;
    }
}

export class PlayerSettingsUpdateEvent extends LiveEvent {

    static wireFields = {
        type: "int32",
        x: "int32",
        y: "int32",
        chunk: "string",
        key: "int32",
        value: "int32",
    };

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
