
/**
 * The declarative register of loaded mods. Mods are registered as ModPackages, then freeze()
 * assigns every object type its positional typeId exactly once; every accessor throws before the
 * freeze, and register throws after it, so the lifecycle is: register loadout, freeze, build the
 * engine/client on the frozen registry.
 */
export class ModRegistry {

    constructor() {
        /**
         * @type {ModPackage[]}
         */
        this._packages = [];
        this._frozen = false;
        this._objectTypes = [];
        this._typeById = new Map();
        // Aggregates computed once at freeze; the getters are on per-event hot paths.
        this._wireClasses = [];
        this._simMods = [];
        this._clientMods = [];
        this._textureDefinitions = [];
        this._itemTextures = {};
    }

    /**
     * @param {ModPackage} pkg
     * @returns {void}
     */
    register(pkg) {
        if (this._frozen) {
            throw new Error("ModRegistry is frozen; register every mod before freeze()");
        }
        this._packages.push(pkg);
    }

    /**
     * Assigns each object type its positional typeId (registration order across the loadout) and
     * validates the loadout; the registry is immutable afterwards.
     * @returns {void}
     */
    freeze() {
        if (this._frozen) {
            throw new Error("ModRegistry.freeze() called twice");
        }
        this._frozen = true;

        const typeNames = new Set();
        for (const pkg of this._packages) {
            for (const type of pkg.declaration.objectTypes) {
                if (typeNames.has(type.name)) {
                    throw new Error(`Duplicate object type "${type.name}"`);
                }
                typeNames.add(type.name);
                type._assignTypeId(this._objectTypes.length);
                this._typeById.set(this._objectTypes.length, type);
                this._objectTypes.push(type);
            }
        }

        const wireClasses = new Set();
        for (const pkg of this._packages) {
            for (const cls of pkg.declaration.wireClasses) {
                if (wireClasses.has(cls)) {
                    throw new Error(`Duplicate wire class "${cls.name}"`);
                }
                wireClasses.add(cls);
                this._wireClasses.push(cls);
            }
        }

        for (const pkg of this._packages) {
            if (pkg.sim !== null) {
                this._simMods.push(pkg.sim);
            }
            if (pkg.client !== null) {
                this._clientMods.push(pkg.client);
            }
            for (const definition of pkg.declaration.textureDefinitions) {
                this._textureDefinitions.push(definition);
            }
            Object.assign(this._itemTextures, pkg.declaration.itemTextures);
        }
    }

    /**
     * @private
     * @returns {void}
     */
    _assertFrozen() {
        if (!this._frozen) {
            throw new Error("ModRegistry not frozen; call freeze() after registering the loadout");
        }
    }

    /**
     * Every object type across the loadout, in typeId order.
     * @returns {ObjectType[]}
     */
    get objectTypes() {
        this._assertFrozen();
        return this._objectTypes;
    }

    /**
     * The object type with the given typeId; throws on an unknown id.
     * @param {number} typeId
     * @returns {ObjectType}
     */
    typeById(typeId) {
        this._assertFrozen();
        const type = this._typeById.get(typeId);
        if (type === undefined) {
            throw new Error(`Unknown object typeId ${typeId}`);
        }
        return type;
    }

    /**
     * Wire classes contributed by all mods, in load order.
     * @returns {Function[]}
     */
    get wireClasses() {
        this._assertFrozen();
        return this._wireClasses;
    }

    /**
     * @returns {AbstractSimMod[]}
     */
    get simMods() {
        this._assertFrozen();
        return this._simMods;
    }

    /**
     * @returns {AbstractClientMod[]}
     */
    get clientMods() {
        this._assertFrozen();
        return this._clientMods;
    }

    /**
     * @returns {TextureDefinition[]}
     */
    get textureDefinitions() {
        this._assertFrozen();
        return this._textureDefinitions;
    }

    /**
     * Item type -> texture name, merged across all mods, for the shared item layer.
     * @returns {Object.<number, string>}
     */
    get itemTextures() {
        this._assertFrozen();
        return this._itemTextures;
    }
}
