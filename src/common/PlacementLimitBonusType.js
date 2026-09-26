/**
 * One way a mod raises a player's placement limit for an object type. Registration order across the
 * loadout assigns the bonusTypeId at ModRegistry.freeze(), which also resolves the object type name.
 */
export class PlacementLimitBonusType {

    /**
     * @param {string} name unique across the loadout
     * @param {string} label the player-visible name
     * @param {string} objectTypeName the object type whose limit this raises
     * @param {number} amount
     */
    constructor(name, label, objectTypeName, amount) {
        this.name = name;
        this.label = label;
        this.objectTypeName = objectTypeName;
        this.amount = amount;
        this._bonusTypeId = null;
        this._objectTypeId = null;
    }

    /**
     * @returns {number}
     */
    get bonusTypeId() {
        if (this._bonusTypeId === null) {
            throw new Error(`PlacementLimitBonusType "${this.name}" has no bonusTypeId; freeze the ModRegistry first`);
        }
        return this._bonusTypeId;
    }

    /**
     * @returns {number}
     */
    get objectTypeId() {
        if (this._objectTypeId === null) {
            throw new Error(`PlacementLimitBonusType "${this.name}" has no objectTypeId; freeze the ModRegistry first`);
        }
        return this._objectTypeId;
    }

    /**
     * Called by ModRegistry.freeze().
     * @param {number} bonusTypeId
     * @param {number} objectTypeId
     * @returns {void}
     */
    _assignTypeIds(bonusTypeId, objectTypeId) {
        this._bonusTypeId = bonusTypeId;
        this._objectTypeId = objectTypeId;
    }
}
