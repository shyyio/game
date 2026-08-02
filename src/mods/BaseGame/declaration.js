import {AbstractModDeclaration, MarketListingEntry} from "@/sdk/common.js";
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
 * The real game content: recipes/Items.puml's whole production chain, from primary extraction
 * through the Biotech (food/adrenochrome/potion) and Industry (steel/glass) chains to the final
 * Stimpack assembly.
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
            [ITEM_TYPE_WATER]: "items/1",
            [ITEM_TYPE_SOUL]: "items/2",
            [ITEM_TYPE_SOYBEAN_SEEDS]: "items/1",
            [ITEM_TYPE_SOYBEAN]: "items/2",
            [ITEM_TYPE_MUSHROOM_SPORE]: "items/1",
            [ITEM_TYPE_MUSHROOM]: "items/2",
            [ITEM_TYPE_NUTRIENT_SLOP]: "items/1",
            [ITEM_TYPE_CREATURE]: "items/2",
            [ITEM_TYPE_ADRENOCHROME]: "items/1",
            [ITEM_TYPE_BASIC_POTION_BASE]: "items/2",
            [ITEM_TYPE_OVERLOAD_MIX]: "items/1",
            [ITEM_TYPE_IRON_ORE]: "items/2",
            [ITEM_TYPE_COAL]: "items/1",
            [ITEM_TYPE_COKE]: "items/2",
            [ITEM_TYPE_OXYGEN]: "items/2",
            [ITEM_TYPE_RAW_STEEL]: "items/1",
            [ITEM_TYPE_STEEL_PARTS]: "items/2",
            [ITEM_TYPE_SAND]: "items/1",
            [ITEM_TYPE_GLASS]: "items/2",
            [ITEM_TYPE_EMPTY_SYRINGE]: "items/1",
            [ITEM_TYPE_STIMPACK]: "items/2",
            [ITEM_TYPE_WASTE]: "items/1",
        };
    }

    get marketListings() {
        return [
            new MarketListingEntry(ITEM_TYPE_SOYBEAN_SEEDS, NPC_PRICE_SOYBEAN_SEEDS),
            new MarketListingEntry(ITEM_TYPE_MUSHROOM_SPORE, NPC_PRICE_MUSHROOM_SPORE),
        ];
    }

    // Water, Oxygen, Nutrient Slop, and Basic Potion Base are fluids: they fill pipes and never rest
    // as a port item sprite. Basic Potion Base being a liquid is what lets Brew's fluid-side port
    // carry it (recipe 2) and Water (recipe 1) without a port-role conflict — see BrewType.
    get fluidTypes() {
        return [ITEM_TYPE_WATER, ITEM_TYPE_OXYGEN, ITEM_TYPE_NUTRIENT_SLOP, ITEM_TYPE_BASIC_POTION_BASE];
    }
}
