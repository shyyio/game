/** @typedef {string} FieldRole */

// What the client draws a synced field as.
export const FIELD_ROLE_PRODUCT = "product";
export const FIELD_ROLE_STALL = "stall";

/**
 * One component field the engine mirrors into the client's object data under the same name.
 */
export class SyncedField {

    /**
     * @param {string} name
     * @param {number} [defaultValue] - what a row holds until written; the client assumes it until told
     *     otherwise, and chunk sync sends only rows off it
     * @param {FieldRole|null} [role] - what the client draws it as; a behavior declares at most one
     *     field per role
     */
    constructor(name, defaultValue=0, role=null) {
        this.name = name;
        this.defaultValue = defaultValue;
        this.role = role;
    }
}

/**
 * A behavior's synced fields: which component holds them and, in wire order, which fields.
 */
export class SyncedFieldSet {

    /**
     * @param {string} component
     * @param {SyncedField[]} fields
     */
    constructor(component, fields) {
        this.component = component;
        this.fields = fields;
        /**
         * @type {Map<FieldRole, SyncedField>}
         * @private
         */
        this._fieldByRole = new Map();
        for (const field of fields) {
            if (field.role === null) {
                continue;
            }
            if (this._fieldByRole.has(field.role)) {
                throw new Error(`Component "${component}" declares two ${field.role} fields; a behavior has one per role`);
            }
            this._fieldByRole.set(field.role, field);
        }
    }

    /**
     * @param {FieldRole} role
     * @returns {SyncedField|null}
     */
    getFieldByRoleOrNull(role) {
        const field = this._fieldByRole.get(role);
        if (field === undefined) {
            return null;
        }
        return field;
    }
}
