/**
 * One component field the engine mirrors into the client's object data under the same name.
 */
export class SyncedField {

    /**
     * @param {string} name
     * @param {number} [defaultValue] - what a row holds until written; the client assumes it until told
     *     otherwise, and chunk sync sends only rows off it
     */
    constructor(name, defaultValue=0) {
        this.name = name;
        this.defaultValue = defaultValue;
    }
}

/**
 * A behavior's synced fields: which component holds them and, in wire order, which fields.
 */
export class SyncedFields {

    /**
     * @param {string} component
     * @param {SyncedField[]} fields
     */
    constructor(component, fields) {
        this.component = component;
        this.fields = fields;
    }
}
