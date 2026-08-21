import {NotImplementedError} from "@/common/error.js";

/**
 * The pure-data part of a mod, shared by sim and client: the object types it adds, the classes it
 * sends over the wire, and its texture contributions. Bespoke behavior lives in the optional sim
 * part (AbstractSimMod) and client part (AbstractClientMod), bundled by a ModPackage.
 */
export class AbstractModDeclaration {

    /**
     * The mod's display name.
     * @abstract
     * @returns {string}
     */
    get name() {
        throw new NotImplementedError();
    }

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
     * Item type -> definition (name, render texture); item types must be unique across the loadout.
     * @returns {Object.<number, ItemDefinition>}
     */
    get items() {
        return {};
    }

    /**
     * Payload numbers that are fluids: a fluid resting in a rendered port draws no item sprite.
     * @returns {number[]}
     */
    get fluidTypes() {
        return [];
    }

    /**
     * Per-key player-setting configs this mod adds; keys must be unique across the loadout.
     * @returns {PlayerSettingEntry[]}
     */
    get playerSettingEntries() {
        return [];
    }

    /**
     * Terrain noise channels this mod samples; registration order across the loadout assigns each
     * its channelId at ModRegistry.freeze(). Names must be unique across the loadout.
     * @returns {NoiseChannel[]}
     */
    get noiseChannels() {
        return [];
    }

    /**
     * Terrain biomes this mod adds, tested in registration order (first match wins); the loadout's
     * last biome must be unconditional. Names must be unique across the loadout.
     * @returns {Biome[]}
     */
    get biomes() {
        return [];
    }

    /**
     * Item types this mod adds to the market's tradable catalog; item types must be unique across
     * the loadout.
     * @returns {MarketListingEntry[]}
     */
    get marketListings() {
        return [];
    }

    /**
     * Metrics types this mod opens to GLOBAL-scope queries; metrics types must be unique across
     * the loadout.
     * @returns {MetricsGlobalQueryEntry[]}
     */
    get metricsGlobalQueries() {
        return [];
    }
}
