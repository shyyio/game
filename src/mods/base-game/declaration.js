import {AbstractModDeclaration, MarketListingEntry, ItemType, ItemAgeFrameEntry, ItemCategory} from "@spup/sdk";
import {
    RESOURCE_TYPES,
    ExtractorType,
    MACHINE_TYPES,
} from "./common/objectTypes.js";
import {
    ITEM_TYPE_WATER,
    ITEM_TYPE_SOUL,
    ITEM_TYPE_CABBAGE_SEED,
    ITEM_TYPE_CABBAGE,
    ITEM_TYPE_MUSHROOM_SPORE,
    ITEM_TYPE_MUSHROOM,
    ITEM_TYPE_NUTRIENT_SLOP,
    ITEM_TYPE_CREATURE,
    ITEM_TYPE_ADRENOCHROME,
    ITEM_TYPE_BASIC_POTION_BASE,
    ITEM_TYPE_OVERLOAD_MIX,
    ITEM_TYPE_IRON_ORE,
    ITEM_TYPE_COAL,
    ITEM_TYPE_COKE,
    ITEM_TYPE_OXYGEN,
    ITEM_TYPE_RAW_STEEL,
    ITEM_TYPE_STEEL_PARTS,
    ITEM_TYPE_SAND,
    ITEM_TYPE_GLASS,
    ITEM_TYPE_EMPTY_SYRINGE,
    ITEM_TYPE_STIMPACK,
    ITEM_TYPE_WASTE,
    NPC_PRICE_CABBAGE_SEED,
    NPC_PRICE_MUSHROOM_SPORE,
} from "./common/constants.js";
import {NOISE_CHANNELS, BIOMES} from "./common/terrain.js";

// Raw steel leaves the furnace glowing and cools over five ticks; steel3 is cold, and the frame an
// ageless one shows.
const RAW_STEEL_COOLING = [
    new ItemAgeFrameEntry("items/steel0", 0),
    new ItemAgeFrameEntry("items/steel1", 3),
    new ItemAgeFrameEntry("items/steel2", 5),
    new ItemAgeFrameEntry("items/steel3", 7),
];

/**
 * The real game content: the whole production chain, from primary extraction through the
 * Biotech (food/adrenochrome/potion) and Industry (steel/glass) chains to the final Stimpack assembly.
 */
export class BaseGameDeclaration extends AbstractModDeclaration {

    /**
     * @returns {string}
     */
    get name() {
        return "BaseGame";
    }

    get objectTypes() {
        return [...RESOURCE_TYPES, ExtractorType, ...MACHINE_TYPES];
    }

    get items() {
        return [
            new ItemCategory("Agriculture", {
                [ITEM_TYPE_CABBAGE_SEED]: new ItemType("Cabbage Seed", "items/cabbageseeds"),
                [ITEM_TYPE_CABBAGE]: new ItemType("Cabbage", "items/cabbage"),
                [ITEM_TYPE_MUSHROOM_SPORE]: new ItemType("Mushroom Spore", "items/mushspores"),
                [ITEM_TYPE_MUSHROOM]: new ItemType("Mushroom", "items/mushroom"),
                // Fluids never render as a port item sprite, so the texture is unused.
                [ITEM_TYPE_NUTRIENT_SLOP]: new ItemType("Nutrient Slop", "items/nutrientslop"),
            }),
            new ItemCategory("Alchemy", {
                [ITEM_TYPE_SOUL]: new ItemType("Soul", "items/soul1"),
                [ITEM_TYPE_CREATURE]: new ItemType("Creature", "items/creature1"),
                [ITEM_TYPE_ADRENOCHROME]: new ItemType("Adrenochrome", "items/adrenochrome"),
                [ITEM_TYPE_BASIC_POTION_BASE]: new ItemType("Basic Potion Base", "items/basicpotionbase"),
                [ITEM_TYPE_OVERLOAD_MIX]: new ItemType("Overload Mix", "items/overloadmix"),
            }),
            new ItemCategory("Metallurgy", {
                [ITEM_TYPE_IRON_ORE]: new ItemType("Iron Ore", "items/ironore"),
                [ITEM_TYPE_COAL]: new ItemType("Coal", "items/coal"),
                [ITEM_TYPE_COKE]: new ItemType("Coke", "items/coke"),
                [ITEM_TYPE_RAW_STEEL]: new ItemType("Raw Steel", "items/steel3", 0xFFFFFF, RAW_STEEL_COOLING),
                [ITEM_TYPE_STEEL_PARTS]: new ItemType("Steel Parts", "items/steelparts"),
            }),
            new ItemCategory("Power Up", {
                [ITEM_TYPE_STIMPACK]: new ItemType("Stimpack", "items/1-gray", 0xE63946),
            }),
            new ItemCategory("Miscellaneous", {
                [ITEM_TYPE_WATER]: new ItemType("Water", "items/water"),
                [ITEM_TYPE_OXYGEN]: new ItemType("Oxygen", "items/2-gray"),
                [ITEM_TYPE_SAND]: new ItemType("Sand", "items/sand"),
                [ITEM_TYPE_GLASS]: new ItemType("Glass", "items/1-gray", 0xBEEAF0),
                [ITEM_TYPE_EMPTY_SYRINGE]: new ItemType("Empty Syringe", "items/1-gray", 0xD9D9D9),
                [ITEM_TYPE_WASTE]: new ItemType("Waste", "items/4-gray", 0x6B6B47),
            }),
        ];
    }

    get noiseChannels() {
        return NOISE_CHANNELS;
    }

    get biomes() {
        return BIOMES;
    }

    get marketListings() {
        return [
            new MarketListingEntry(ITEM_TYPE_CABBAGE_SEED, NPC_PRICE_CABBAGE_SEED),
            new MarketListingEntry(ITEM_TYPE_MUSHROOM_SPORE, NPC_PRICE_MUSHROOM_SPORE),
        ];
    }

    // Fill pipes, never render as a port item sprite.
    get fluidTypes() {
        return [
            ITEM_TYPE_WATER,
            ITEM_TYPE_OXYGEN,
            ITEM_TYPE_NUTRIENT_SLOP,
            ITEM_TYPE_BASIC_POTION_BASE,
            ITEM_TYPE_OVERLOAD_MIX,
        ];
    }
}
