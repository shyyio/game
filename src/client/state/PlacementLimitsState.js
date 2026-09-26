import {OwnPlacementLimitsSyncEvent, OwnPlacedCountEvent, PlacementLimitBonusGrantedEvent} from "@/common/PlacementLimitEvents.js";
import {AbstractCacheWriter, AbstractCacheView, schemaMap, schemaSet} from "@/client/state/ClientCache.js";

export const PLACEMENT_LIMITS_SCHEMA = {
    // objectTypeId -> how many of it the own player has placed, limited types only.
    countByTypeId: schemaMap(),
    // The placement limit bonuses the own player holds.
    bonusTypeIds: schemaSet(),
};

/**
 * Writes the own player's placed counts and bonuses from the connect-time sync and the targeted
 * deltas.
 */
export class PlacementLimitsWriter extends AbstractCacheWriter {

    /**
     * @param {ModRegistry} modRegistry
     * @param {ClientCache} state
     */
    constructor(modRegistry, state) {
        super(state);
        this._modRegistry = modRegistry;
    }

    onEvent(event) {
        if (event instanceof OwnPlacementLimitsSyncEvent) {
            const types = this._modRegistry.limitedObjectTypes;
            for (let i = 0; i < types.length; i += 1) {
                this._state.mapSet("placementLimits.countByTypeId", types[i].objectTypeId, event.ownCounts[i]);
            }
            this._state.setReplace("placementLimits.bonusTypeIds", event.ownBonusTypeIds);
            return;
        }
        if (event instanceof OwnPlacedCountEvent) {
            this._state.mapSet("placementLimits.countByTypeId", event.objectTypeId, event.ownCount);
            return;
        }
        if (event instanceof PlacementLimitBonusGrantedEvent) {
            this._state.setAdd("placementLimits.bonusTypeIds", event.bonusTypeId);
        }
    }
}

/**
 * Derived reads over the placementLimits namespace; mirrors the sim's placement limit gate.
 */
export class PlacementLimitsView extends AbstractCacheView {

    /**
     * @param {ModRegistry} modRegistry
     */
    constructor(modRegistry) {
        super();
        this._modRegistry = modRegistry;
    }

    /**
     * @param {number} objectTypeId
     * @returns {number}
     */
    getCountByTypeId(objectTypeId) {
        const count = this._state.mapGet("placementLimits.countByTypeId", objectTypeId);
        if (count === undefined) {
            return 0;
        }
        return count;
    }

    /**
     * The type's initial limit plus every bonus the own player holds for it.
     * @param {number} objectTypeId
     * @returns {number}
     */
    getLimitByTypeId(objectTypeId) {
        let limit = this._modRegistry.getObjectTypeByTypeId(objectTypeId).initialPlacementLimit;
        if (limit === null) {
            throw new Error(`Object type ${objectTypeId} has no placement limit`);
        }
        for (const bonusTypeId of this._state.setValues("placementLimits.bonusTypeIds")) {
            const bonus = this._modRegistry.getPlacementLimitBonusByTypeId(bonusTypeId);
            if (bonus.objectTypeId === objectTypeId) {
                limit += bonus.amount;
            }
        }
        return limit;
    }

    /**
     * How many more of the type the own player may place.
     * @param {number} objectTypeId
     * @returns {number}
     */
    getRemainingByTypeId(objectTypeId) {
        return Math.max(0, this.getLimitByTypeId(objectTypeId) - this.getCountByTypeId(objectTypeId));
    }

    /**
     * Whether the own player may place no more of the type; always false for an unlimited type.
     * @param {number} objectTypeId
     * @returns {boolean}
     */
    isAtLimit(objectTypeId) {
        if (this._modRegistry.getObjectTypeByTypeId(objectTypeId).initialPlacementLimit === null) {
            return false;
        }
        return this.getRemainingByTypeId(objectTypeId) === 0;
    }
}
