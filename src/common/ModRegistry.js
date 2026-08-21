import {CORE_PLAYER_SETTING_ENTRIES} from "@/common/PlayerSettingEntry.js";
import {ItemRegistry} from "@/common/ItemRegistry.js";
import {CORE_NOISE_CHANNELS} from "@/common/Terrain.js";

// Terrain bakes store one byte per tile.
const BIOME_LIMIT = 255;

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
        this._textureAtlases = [];
        /**
         * @type {ItemRegistry}
         */
        this._items = new ItemRegistry();
        /**
         * @type {Set<number>}
         */
        this._fluidTypes = new Set();
        /**
         * @type {Map<number, PlayerSettingEntry>}
         */
        this._playerSettingEntries = new Map();
        /**
         * @type {NoiseChannel[]}
         */
        this._noiseChannels = [];
        /**
         * @type {Biome[]}
         */
        this._biomes = [];
        /**
         * @type {MarketListingEntry[]}
         */
        this._marketListings = [];
        /**
         * @type {Map<number, MetricsGlobalQueryEntry>}
         */
        this._metricsGlobalQueries = new Map();
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
     * validates the loadout; the registry is immutable afterward.
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
                this._textureAtlases.push(...pkg.client.textureAtlases());
            }
            for (const [itemType, definition] of Object.entries(pkg.declaration.items)) {
                this._items.register(Number(itemType), definition);
            }
            for (const fluidType of pkg.declaration.fluidTypes) {
                this._fluidTypes.add(fluidType);
            }
        }

        for (const entry of CORE_PLAYER_SETTING_ENTRIES) {
            this._playerSettingEntries.set(entry.key, entry);
        }
        for (const pkg of this._packages) {
            for (const entry of pkg.declaration.playerSettingEntries) {
                if (this._playerSettingEntries.has(entry.key)) {
                    throw new Error(`Duplicate player setting key ${entry.key}`);
                }
                this._playerSettingEntries.set(entry.key, entry);
            }
        }

        const channelNames = new Set();
        for (const channel of CORE_NOISE_CHANNELS) {
            channelNames.add(channel.name);
            channel._assignChannelId(this._noiseChannels.length);
            this._noiseChannels.push(channel);
        }
        for (const pkg of this._packages) {
            for (const channel of pkg.declaration.noiseChannels) {
                if (channelNames.has(channel.name)) {
                    throw new Error(`Duplicate noise channel "${channel.name}"`);
                }
                channelNames.add(channel.name);
                channel._assignChannelId(this._noiseChannels.length);
                this._noiseChannels.push(channel);
            }
        }

        const biomeNames = new Set();
        for (const pkg of this._packages) {
            for (const biome of pkg.declaration.biomes) {
                if (biomeNames.has(biome.name)) {
                    throw new Error(`Duplicate biome "${biome.name}"`);
                }
                for (const range of biome.ranges) {
                    if (!this._noiseChannels.includes(range.channel)) {
                        throw new Error(`Biome "${biome.name}" ranges over undeclared noise channel "${range.channel.name}"`);
                    }
                }
                biomeNames.add(biome.name);
                biome._assignBiomeId(this._biomes.length);
                this._biomes.push(biome);
            }
        }
        if (this._biomes.length > BIOME_LIMIT) {
            throw new Error(`${this._biomes.length} biomes declared; a terrain bake holds at most ${BIOME_LIMIT}`);
        }
        if (this._biomes.length > 0 && this._biomes[this._biomes.length - 1].ranges.length > 0) {
            throw new Error(`Last biome "${this._biomes[this._biomes.length - 1].name}" must be unconditional (no ranges)`);
        }

        const listedItemTypes = new Set();
        for (const pkg of this._packages) {
            for (const entry of pkg.declaration.marketListings) {
                if (listedItemTypes.has(entry.itemType)) {
                    throw new Error(`Duplicate market listing for item type ${entry.itemType}`);
                }
                listedItemTypes.add(entry.itemType);
                this._marketListings.push(entry);
            }
        }

        for (const pkg of this._packages) {
            for (const entry of pkg.declaration.metricsGlobalQueries) {
                if (this._metricsGlobalQueries.has(entry.metricsType)) {
                    throw new Error(`Duplicate metrics global query for type ${entry.metricsType}`);
                }
                this._metricsGlobalQueries.set(entry.metricsType, entry);
            }
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
     * The loaded mods' display names, in registration order.
     * @returns {string[]}
     */
    get modNames() {
        this._assertFrozen();
        return this._packages.map(pkg => pkg.declaration.name);
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
     * Every atlas the loadout's client parts ship, in registration order.
     * @returns {TextureAtlas[]}
     */
    get textureAtlases() {
        this._assertFrozen();
        return this._textureAtlases;
    }

    /**
     * The item definitions merged across all mods.
     * @returns {ItemRegistry}
     */
    get items() {
        this._assertFrozen();
        return this._items;
    }

    /**
     * Fluid payload numbers, merged across all mods.
     * @returns {Set<number>}
     */
    get fluidTypes() {
        this._assertFrozen();
        return this._fluidTypes;
    }

    /**
     * The player-setting entry for a key, or undefined for an unregistered key (a client write
     * to one is dropped).
     * @param {number} key
     * @returns {PlayerSettingEntry|undefined}
     */
    playerSettingEntry(key) {
        this._assertFrozen();
        return this._playerSettingEntries.get(key);
    }

    /**
     * Every noise channel, the engine's first then the loadout's, in channelId order.
     * @returns {NoiseChannel[]}
     */
    get noiseChannels() {
        this._assertFrozen();
        return this._noiseChannels;
    }

    /**
     * Every biome across the loadout, in biomeId order.
     * @returns {Biome[]}
     */
    get biomes() {
        this._assertFrozen();
        return this._biomes;
    }

    /**
     * Every item type listed on the market, merged across all mods.
     * @returns {MarketListingEntry[]}
     */
    get marketListings() {
        this._assertFrozen();
        return this._marketListings;
    }

    /**
     * The GLOBAL-query declaration for a metrics type, or undefined for a private type (a GLOBAL
     * query for one fails validation).
     * @param {number} metricsType
     * @returns {MetricsGlobalQueryEntry|undefined}
     */
    metricsGlobalQuery(metricsType) {
        this._assertFrozen();
        return this._metricsGlobalQueries.get(metricsType);
    }
}
