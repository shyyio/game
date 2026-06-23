import {AbstractEvent} from "@/common/AbstractEvent.js";

export class GameSettingsSyncEvent extends AbstractEvent {

    static wireFields = {
        values: "map<int32,int32>",
    };

    /**
     * @param {Object.<number, number>} values - all key→value pairs
     */
    constructor(values) {
        super();
        this.values = values;
    }
}

export class GameSettingsUpdateEvent extends AbstractEvent {

    static wireFields = {
        key: "int32",
        value: "int32",
    };

    /**
     * @param {number} key
     * @param {number} value
     */
    constructor(key, value) {
        super();
        this.key = key;
        this.value = value;
    }
}
