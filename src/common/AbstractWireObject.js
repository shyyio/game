/**
 * Base for everything on the wire (messages and events): carries the `wireFields` codec contract.
 * @abstract
 */
export class AbstractWireObject {

    /**
     * Maps each wire-serialized field name to its protobuf spec string; subclasses MUST override.
     * @type {Object.<string, string>}
     */
    static wireFields;

    constructor() {
        if (this.constructor.wireFields === undefined) {
            throw new Error(`${this.constructor.name} extends AbstractWireObject but has no static wireFields`);
        }
    }
}
