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
 * The synced field holding the item type an object offers as its product, which the client draws
 * over it.
 */
export class ProductField extends SyncedField {

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
         * @type {ProductField|null}
         */
        this.productField = null;
        for (const field of fields) {
            if (!(field instanceof ProductField)) {
                continue;
            }
            if (this.productField !== null) {
                throw new Error(`Component "${component}" declares two product fields; a behavior has one product field`);
            }
            this.productField = field;
        }
    }
}
