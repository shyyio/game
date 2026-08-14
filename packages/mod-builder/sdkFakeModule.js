// What `@/sdk/common.js` and `@/sdk/client.js` resolve to under the test loader: one namespace of
// fakes, so a mod's spec can import its own files and read back what they built.

import {sdkFake} from "./sdkFake.js";

const fake = sdkFake();

export default fake;

// A module namespace cannot be a Proxy, so the loader hands specs this module and node's named
// imports come off the re-export below.
export const {
    AbstractModDeclaration, AbstractSimMod, AbstractClientMod, ModPackage, ModRegistry,
    ObjectType, PortDefinition, RecipeDefinition, RecipeByproduct, PlacementRule,
    ItemDefinition, TextureAtlas, MarketListingEntry, PlayerSettingEntry, MetricsGlobalQueryEntry,
    AbstractBehavior, StaticBehavior, MachineBehavior, ExtractorBehavior, GeneratorBehavior,
    ResourceBehavior, RoadBehavior, HousingBehavior,
    AbstractMessage, AbstractEvent, AbstractChunkRoutedEvent, AbstractBatchEvent,
    Direction, CHUNK_SIZE, LAYER_SURFACE, PLAYER_ID_NONE, TickPhase, EMPTY, NO_EID, TILE_SIZE,
} = fake;
