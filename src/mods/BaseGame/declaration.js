import {AbstractModDeclaration, MarketListingEntry, ItemDefinition} from "@spup/sdk";
import {
    RESOURCE_TYPES,
    ExtractorType,
    MACHINE_TYPES,
} from "./common/objectTypes.js";
import {
    ITEM_TYPE_WATER,
    ITEM_TYPE_SOUL,
    ITEM_TYPE_SOYBEAN_SEEDS,
    ITEM_TYPE_SOYBEAN,
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
    NPC_PRICE_SOYBEAN_SEEDS,
    NPC_PRICE_MUSHROOM_SPORE,
} from "./common/constants.js";

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
        return {
            // Fluids never render as a port item sprite; texture unused, tint irrelevant.
            [ITEM_TYPE_WATER]: new ItemDefinition("Water", "items/1-gray"),
            [ITEM_TYPE_NUTRIENT_SLOP]: new ItemDefinition("Nutrient Slop", "items/1-gray"),
            [ITEM_TYPE_OXYGEN]: new ItemDefinition("Oxygen", "items/2-gray"),
            [ITEM_TYPE_BASIC_POTION_BASE]: new ItemDefinition("Basic Potion Base", "items/2-gray"),

            [ITEM_TYPE_SOUL]: new ItemDefinition("Soul", "items/3-gray", 0xC8D8FF),
            [ITEM_TYPE_SOYBEAN_SEEDS]: new ItemDefinition("Soybean Seeds", "items/3-gray", 0xD8C878),
            [ITEM_TYPE_MUSHROOM_SPORE]: new ItemDefinition("Mushroom Spore", "items/3-gray", 0x9B7FBF),

            [ITEM_TYPE_SOYBEAN]: new ItemDefinition("Soybean", "items/4-gray", 0x8FBF5A),
            [ITEM_TYPE_MUSHROOM]: new ItemDefinition("Mushroom", "items/4-gray", 0xC98A4B),
            [ITEM_TYPE_CREATURE]: new ItemDefinition("Creature", "items/4-gray", 0xE8A0A0),
            [ITEM_TYPE_WASTE]: new ItemDefinition("Waste", "items/4-gray", 0x6B6B47),

            [ITEM_TYPE_IRON_ORE]: new ItemDefinition("Iron Ore", "items/2-gray", 0xA0522D),
            [ITEM_TYPE_COAL]: new ItemDefinition("Coal", "items/2-gray", 0x3A3A3A),
            [ITEM_TYPE_COKE]: new ItemDefinition("Coke", "items/2-gray", 0x708090),
            [ITEM_TYPE_SAND]: new ItemDefinition("Sand", "items/2-gray", 0xE0C878),

            [ITEM_TYPE_ADRENOCHROME]: new ItemDefinition("Adrenochrome", "items/1-gray", 0xFF3EA5),
            [ITEM_TYPE_OVERLOAD_MIX]: new ItemDefinition("Overload Mix", "items/1-gray", 0x4BE04B),
            [ITEM_TYPE_RAW_STEEL]: new ItemDefinition("Raw Steel", "items/1-gray", 0xB0B8C0),
            [ITEM_TYPE_STEEL_PARTS]: new ItemDefinition("Steel Parts", "items/1-gray", 0x5B7FA6),
            [ITEM_TYPE_GLASS]: new ItemDefinition("Glass", "items/1-gray", 0xBEEAF0),
            [ITEM_TYPE_EMPTY_SYRINGE]: new ItemDefinition("Empty Syringe", "items/1-gray", 0xD9D9D9),
            [ITEM_TYPE_STIMPACK]: new ItemDefinition("Stimpack", "items/1-gray", 0xE63946),
        };
    }

    get marketListings() {
        return [
            new MarketListingEntry(ITEM_TYPE_SOYBEAN_SEEDS, NPC_PRICE_SOYBEAN_SEEDS),
            new MarketListingEntry(ITEM_TYPE_MUSHROOM_SPORE, NPC_PRICE_MUSHROOM_SPORE),
        ];
    }

    // Water, Oxygen, Nutrient Slop, Basic Potion Base fill pipes, never render as a port item sprite.
    get fluidTypes() {
        return [ITEM_TYPE_WATER, ITEM_TYPE_OXYGEN, ITEM_TYPE_NUTRIENT_SLOP, ITEM_TYPE_BASIC_POTION_BASE];
    }
}
