import {PLAYER_REF_NONE} from "@/common/constants.js";
import {AbstractSystem} from "@/sim/AbstractSystem.js";
import {OwnPlacedCountEvent, PlacementLimitBonusGrantedEvent} from "@/common/PlacementLimitEvents.js";

export const PLACEMENT_LIMIT_BONUS_TABLE = "PlacementLimitBonus";

/**
 * How many objects of each type every player has placed, kept from the spawn and despawn
 * lifecycle and rebuilt from the PlacedObject column on load, and the bonuses granted to each
 * player over the types' initial limits.
 */
export class PlacementLimitIndex extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     * @param {PlacedObjectIndex} placed
     */
    constructor(engine, placed) {
        super();
        this.engine = engine;
        this.placed = placed;
        /**
         * @type {Map<number, Map<number, number>>}
         */
        this._countsByPlayerRef = new Map();
        /**
         * @type {Map<number, Set<number>>}
         */
        this._grantedByPlayerRef = new Map();
        engine.registerSystem(this);
    }

    /**
     * The type's initial limit plus every bonus granted to the player for it.
     * @param {number} playerRef
     * @param {number} objectTypeId
     * @returns {number}
     */
    getLimitByPlayerRef(playerRef, objectTypeId) {
        const registry = this.engine.modRegistry;
        let limit = registry.getObjectTypeByTypeId(objectTypeId).initialPlacementLimit;
        if (limit === null) {
            throw new Error(`Object type ${objectTypeId} has no placement limit`);
        }
        for (const bonusTypeId of this.getBonusTypeIdsByPlayerRef(playerRef)) {
            const bonus = registry.getPlacementLimitBonusByTypeId(bonusTypeId);
            if (bonus.objectTypeId === objectTypeId) {
                limit += bonus.amount;
            }
        }
        return limit;
    }

    /**
     * Whether the player may place no more of the type; always false for an unlimited type.
     * @param {number} playerRef
     * @param {number} objectTypeId
     * @returns {boolean}
     */
    isAtLimit(playerRef, objectTypeId) {
        if (this.engine.modRegistry.getObjectTypeByTypeId(objectTypeId).initialPlacementLimit === null) {
            return false;
        }
        return this.getCountByPlayerRef(playerRef, objectTypeId) >= this.getLimitByPlayerRef(playerRef, objectTypeId);
    }

    /**
     * @param {number} playerRef
     * @returns {number[]}
     */
    getBonusTypeIdsByPlayerRef(playerRef) {
        const granted = this._grantedByPlayerRef.get(playerRef);
        if (granted === undefined) {
            return [];
        }
        return Array.from(granted);
    }

    /**
     * @param {number} playerRef
     * @param {number} bonusTypeId
     * @returns {boolean}
     */
    isGranted(playerRef, bonusTypeId) {
        const granted = this._grantedByPlayerRef.get(playerRef);
        if (granted === undefined) {
            return false;
        }
        return granted.has(bonusTypeId);
    }

    /**
     * Grants a bonus to a player; throws when they already hold it.
     * @param {number} playerRef
     * @param {number} bonusTypeId
     * @returns {void}
     */
    grant(playerRef, bonusTypeId) {
        if (this.isGranted(playerRef, bonusTypeId)) {
            throw new Error(`Bonus ${bonusTypeId} already granted to player ${playerRef}`);
        }
        this._addGrant(playerRef, bonusTypeId);
        this.engine.emitPlayerEvent(playerRef, new PlacementLimitBonusGrantedEvent(bonusTypeId));
    }

    /**
     * @private
     * @param {number} playerRef
     * @param {number} bonusTypeId
     * @returns {void}
     */
    _addGrant(playerRef, bonusTypeId) {
        let granted = this._grantedByPlayerRef.get(playerRef);
        if (granted === undefined) {
            granted = new Set();
            this._grantedByPlayerRef.set(playerRef, granted);
        }
        granted.add(bonusTypeId);
    }

    /**
     * @param {number} playerRef
     * @param {number} objectTypeId
     * @returns {number}
     */
    getCountByPlayerRef(playerRef, objectTypeId) {
        const counts = this._countsByPlayerRef.get(playerRef);
        if (counts === undefined) {
            return 0;
        }
        const count = counts.get(objectTypeId);
        if (count === undefined) {
            return 0;
        }
        return count;
    }

    /**
     * The player's placed counts, parallel to the registry's limited object types.
     * @param {number} playerRef
     * @returns {number[]}
     */
    getCountsByPlayerRef(playerRef) {
        return this.engine.modRegistry.limitedObjectTypes.map(type => this.getCountByPlayerRef(playerRef, type.objectTypeId));
    }

    /**
     * @returns {object} the PlacementLimitBonus table
     */
    serializeTables() {
        const rows = [];
        for (const [playerRef, granted] of this._grantedByPlayerRef) {
            for (const bonusTypeId of granted) {
                rows.push({playerRef, bonusTypeId});
            }
        }
        return {
            name: PLACEMENT_LIMIT_BONUS_TABLE,
            fields: [
                {name: "playerRef", kind: "integer"},
                {name: "bonusTypeId", kind: "integer"},
            ],
            rows,
        };
    }

    /**
     * @param {object|undefined} table - the PlacementLimitBonus table; undefined clears
     * @returns {void}
     */
    deserializeTables(table) {
        this._grantedByPlayerRef.clear();
        if (table === undefined) {
            return;
        }
        for (const row of table.rows) {
            this._addGrant(row.playerRef, row.bonusTypeId);
        }
    }

    onSpawn(eid, objectRef) {
        this._onPlacedChanged(eid, 1);
    }

    onDespawn(eid, objectRef) {
        this._onPlacedChanged(eid, -1);
    }

    rebuild() {
        this._countsByPlayerRef.clear();
        const objects = this.placed.objects;
        const placedBy = objects.store.placedBy;
        const objectTypeIds = objects.store.objectTypeId;
        for (let row = 0; row < objects.count; row += 1) {
            if (placedBy[row] !== PLAYER_REF_NONE) {
                this._addToCount(placedBy[row], objectTypeIds[row], 1);
            }
        }
    }

    /**
     * Counts a player's spawn or despawn and tells their sessions the count of a limited type.
     * @private
     * @param {number} eid
     * @param {number} delta
     * @returns {void}
     */
    _onPlacedChanged(eid, delta) {
        const playerRef = this.placed.getPlacerByEid(eid);
        if (playerRef === PLAYER_REF_NONE) {
            return;
        }
        const objectTypeId = this.placed.getObjectTypeIdByEid(eid);
        const count = this._addToCount(playerRef, objectTypeId, delta);
        if (this.engine.modRegistry.getObjectTypeByTypeId(objectTypeId).initialPlacementLimit !== null) {
            this.engine.emitPlayerEvent(playerRef, new OwnPlacedCountEvent(objectTypeId, count));
        }
    }

    /**
     * @private
     * @param {number} playerRef
     * @param {number} objectTypeId
     * @param {number} delta
     * @returns {number} the new count
     */
    _addToCount(playerRef, objectTypeId, delta) {
        let counts = this._countsByPlayerRef.get(playerRef);
        if (counts === undefined) {
            counts = new Map();
            this._countsByPlayerRef.set(playerRef, counts);
        }
        const count = this.getCountByPlayerRef(playerRef, objectTypeId) + delta;
        counts.set(objectTypeId, count);
        return count;
    }
}
