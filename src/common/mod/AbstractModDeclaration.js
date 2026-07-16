
/**
 * The pure-data part of a mod, shared by sim and client: the object types it adds, the classes it
 * sends over the wire, and its texture contributions. Bespoke behavior lives in the optional sim
 * part (AbstractSimMod) and client part (AbstractClientMod), bundled by a ModPackage.
 */
export class AbstractModDeclaration {

    /**
     * The placeable object types this mod adds; registration order across the loadout assigns
     * each its typeId at ModRegistry.freeze().
     * @returns {ObjectType[]}
     */
    get objectTypes() {
        return [];
    }

    /**
     * Message/event classes this mod sends over the wire (each with a static wireFields map).
     * @returns {Function[]}
     */
    get wireClasses() {
        return [];
    }

    /**
     * @returns {TextureDefinition[]}
     */
    get textureDefinitions() {
        return [];
    }

    /**
     * Item type -> texture name, for the shared item layer.
     * @returns {Object.<number, string>}
     */
    get itemTextures() {
        return {};
    }
}
