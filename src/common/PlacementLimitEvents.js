import {AbstractEvent} from "@/common/AbstractEvent.js";

/**
 * The session's own placed counts, parallel to the registry's limited object types, and the
 * placement limit bonuses it holds; sent on connect. Targeted (publishTo).
 */
export class OwnPlacementLimitsSyncEvent extends AbstractEvent {

    static wireFields = {
        ownCounts: "int32[]",
        ownBonusTypeIds: "int32[]",
    };

    /**
     * @param {number[]} ownCounts
     * @param {number[]} ownBonusTypeIds
     */
    constructor(ownCounts, ownBonusTypeIds) {
        super();
        this.ownCounts = ownCounts;
        this.ownBonusTypeIds = ownBonusTypeIds;
    }
}

/**
 * The player's placed count of one limited type changed. Targeted at the placer's sessions.
 */
export class OwnPlacedCountEvent extends AbstractEvent {

    static wireFields = {
        objectTypeId: "int32",
        ownCount: "int32",
    };

    /**
     * @param {number} objectTypeId
     * @param {number} ownCount
     */
    constructor(objectTypeId, ownCount) {
        super();
        this.objectTypeId = objectTypeId;
        this.ownCount = ownCount;
    }
}

/**
 * The player was granted a placement limit bonus. Targeted at their sessions.
 */
export class PlacementLimitBonusGrantedEvent extends AbstractEvent {

    static wireFields = {
        bonusTypeId: "int32",
    };

    /**
     * @param {number} bonusTypeId
     */
    constructor(bonusTypeId) {
        super();
        this.bonusTypeId = bonusTypeId;
    }
}
