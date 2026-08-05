import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * Sent on connect (the player's stored order) and as the echo after a write; both are a full
 * replace, so one event shape covers both.
 */
export class PlayerSettingsToolOrderSyncEvent extends AbstractEvent {

    static wireFields = {
        toolIds: "int32[]",
    };

    /**
     * @param {number[]} toolIds
     */
    constructor(toolIds) {
        super();
        this.toolIds = toolIds;
    }
}
