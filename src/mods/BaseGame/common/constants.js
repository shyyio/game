// Resource body types, extracted via the shared Extractor into an item.
export const RESOURCE_WATER = 300;
export const RESOURCE_GRAVEYARD = 301;
export const RESOURCE_OXIDE = 302;
export const RESOURCE_COAL = 303;
export const RESOURCE_QUARTZ = 304;

// Item types, following the production chain in recipes/Items.puml.
export const ITEM_TYPE_WATER = 310;
export const ITEM_TYPE_SOUL = 311;
export const ITEM_TYPE_SOYBEAN_SEEDS = 312;
export const ITEM_TYPE_SOYBEAN = 313;
export const ITEM_TYPE_MUSHROOM_SPORE = 314;
export const ITEM_TYPE_MUSHROOM = 315;
export const ITEM_TYPE_NUTRIENT_SLOP = 316;
export const ITEM_TYPE_CREATURE = 317;
export const ITEM_TYPE_ADRENOCHROME = 318;
export const ITEM_TYPE_BASIC_POTION_BASE = 319;
export const ITEM_TYPE_OVERLOAD_MIX = 320;
export const ITEM_TYPE_IRON_ORE = 321;
export const ITEM_TYPE_COAL = 322;
export const ITEM_TYPE_COKE = 323;
export const ITEM_TYPE_OXYGEN = 325;
export const ITEM_TYPE_RAW_STEEL = 326;
export const ITEM_TYPE_STEEL_PARTS = 327;
export const ITEM_TYPE_SAND = 328;
export const ITEM_TYPE_GLASS = 329;
export const ITEM_TYPE_EMPTY_SYRINGE = 330;
export const ITEM_TYPE_STIMPACK = 331;

// Shared fallback output for every machine below: a mis-fed input set (wrong items gathered) always
// produces this instead of silently discarding them.
export const ITEM_TYPE_WASTE = 399;

// Placeholder NPC prices for the two seed items sold at a Trading Terminal; tune once a real economy
// balance pass happens.
export const NPC_PRICE_SOYBEAN_SEEDS = 5;
export const NPC_PRICE_MUSHROOM_SPORE = 8;

// Torment Chamber's Soul byproduct roll.
export const TORMENT_CHAMBER_SOUL_CHANCE = 0.5;

// Workers the Blender consumes when road-connected to housing.
export const BLENDER_WORKER_COST = 2;
