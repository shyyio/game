import {AbstractModDeclaration, MarketListingEntry, ItemTextureEntry} from "@/sdk/common.js";
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

    get itemTextures() {
        return {
            // Fluids never render as a port item sprite; texture unused, tint irrelevant.
            [ITEM_TYPE_WATER]: new ItemTextureEntry("items/1-gray"),
            [ITEM_TYPE_NUTRIENT_SLOP]: new ItemTextureEntry("items/1-gray"),
            [ITEM_TYPE_OXYGEN]: new ItemTextureEntry("items/2-gray"),
            [ITEM_TYPE_BASIC_POTION_BASE]: new ItemTextureEntry("items/2-gray"),

            [ITEM_TYPE_SOUL]: new ItemTextureEntry("items/3-gray", 0xC8D8FF),
            [ITEM_TYPE_SOYBEAN_SEEDS]: new ItemTextureEntry("items/3-gray", 0xD8C878),
            [ITEM_TYPE_MUSHROOM_SPORE]: new ItemTextureEntry("items/3-gray", 0x9B7FBF),

            [ITEM_TYPE_SOYBEAN]: new ItemTextureEntry("items/4-gray", 0x8FBF5A),
            [ITEM_TYPE_MUSHROOM]: new ItemTextureEntry("items/4-gray", 0xC98A4B),
            [ITEM_TYPE_CREATURE]: new ItemTextureEntry("items/4-gray", 0xE8A0A0),
            [ITEM_TYPE_WASTE]: new ItemTextureEntry("items/4-gray", 0x6B6B47),

            [ITEM_TYPE_IRON_ORE]: new ItemTextureEntry("items/2-gray", 0xA0522D),
            [ITEM_TYPE_COAL]: new ItemTextureEntry("items/2-gray", 0x3A3A3A),
            [ITEM_TYPE_COKE]: new ItemTextureEntry("items/2-gray", 0x708090),
            [ITEM_TYPE_SAND]: new ItemTextureEntry("items/2-gray", 0xE0C878),

            [ITEM_TYPE_ADRENOCHROME]: new ItemTextureEntry("items/1-gray", 0xFF3EA5),
            [ITEM_TYPE_OVERLOAD_MIX]: new ItemTextureEntry("items/1-gray", 0x4BE04B),
            [ITEM_TYPE_RAW_STEEL]: new ItemTextureEntry("items/1-gray", 0xB0B8C0),
            [ITEM_TYPE_STEEL_PARTS]: new ItemTextureEntry("items/1-gray", 0x5B7FA6),
            [ITEM_TYPE_GLASS]: new ItemTextureEntry("items/1-gray", 0xBEEAF0),
            [ITEM_TYPE_EMPTY_SYRINGE]: new ItemTextureEntry("items/1-gray", 0xD9D9D9),
            [ITEM_TYPE_STIMPACK]: new ItemTextureEntry("items/1-gray", 0xE63946),
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
