// Mod SDK — engine-agnostic surface.
//
// This is the stable, documented API that mods bind to instead of reaching into
// engine internals. It imports from `src/common/` and `src/sim/`, both of which run on client and
// server alike, so a mod behaves the same in either. Mods import it as `@/sdk/common.js`.
//
// Mod anatomy — a mod is a ModPackage of up to three parts:
//   declaration.js — an AbstractModDeclaration: pure data (objectTypes, wireClasses, items).
//       Most mods are declaration-only: each ObjectType bundles its geometry/ports
//       with a behavior (a component+system bundle) and the engine derives the whole sim and
//       client surface from it.
//   sim.js (optional) — an AbstractSimMod for bespoke sim content, in ECS terms: define components
//       (sim.components.define), register per-phase systems (sim.registerSystem(phase, fn, order)),
//       handle spawn/despawn messages (sim.registerMessageHandler). Share instances across mods
//       via sim.provide(ServiceKey, instance) / sim.resolve(ServiceKey).
//   client.js (optional) — an AbstractClientMod for bespoke rendering/input (see @/sdk/client.js).
//
// Mod directory layout — the entry files above sit at the mod root; everything else mirrors the
// repo's layering (see mods/Logistics for the full shape):
//   common/ — modules both sides import: object types, constants, wire events, geometry.
//   sim/    — behaviors and sim engines (imported by common/ types and the sim entry).
//   client/ — draw layers and tools (imported only by client.js).
// Files are named after the class they export (BeltDrawLayer.js exports BeltDrawLayer); specs sit
// beside the module they test.
//
// Lifecycle: register the loadout's packages into a ModRegistry, freeze() it once (assigning every
// ObjectType its positional typeId and every wire class its wireId), then build the GameEngine /
// Client on the frozen registry. Both build sites share `src/mods/loadout.js`, so the positional
// ids always match between sim and client.
//
// Client-only API (draw layers, tools, pixi types) lives in `@/sdk/client.js`,
// which re-exports everything here. Everything a mod is meant to use should be
// reachable from these two files and nowhere else.

// ---- SDK version ----
// The version of this SDK surface, declared by every packaged mod (mod.json's `sdkVersion`) and
// checked before a bundle is evaluated. Bump on any breaking change to either SDK file — a removed
// or renamed export, or a changed signature/semantics of one; pure additions keep the number.
export {SDK_VERSION} from "@/common/ModManifest.js";

// ---- Mod framework ----
// A mod is a ModPackage: a pure-data declaration (object types, wire classes) plus its texture
// atlases, an optional sim part, and an optional client part, registered into a ModRegistry and
// frozen once.
export {AbstractModDeclaration} from "@/common/AbstractModDeclaration.js";
export {ModPackage} from "@/common/ModPackage.js";
export {ModRegistry} from "@/common/ModRegistry.js";
export {AbstractSimMod} from "@/sim/AbstractSimMod.js";
export {
    ObjectType,       // the entity blueprint for a placeable: ports, geometry, behavior, rules
    PortDefinition,   // one input/output/internal port on an object (position + facing)
    RecipeDefinition, // one recipe: a consumed input set mapping to an output item
    RecipeByproduct,  // a recipe's chance-driven secondary output
    PlacementRule,    // how an object type may be placed (overwrite/advance/placeOn/solid)
    CONVEYS_ITEM,     // transport kinds for ObjectType.conveys adjacency rules
    CONVEYS_FLUID,
} from "@/common/ObjectType.js";

// ---- Behaviors ----
// Component+system bundles a declaration plugs into an ObjectType's `behavior` slot; the engine's
// PlacedObjects host derives the whole entity lifecycle from them. The base class and the empty
// StaticBehavior sit in common/ beside ObjectType; the ones below it reach into the engine.
// TickPhase is the enum of the per-tick phases systems are scheduled into.
export {AbstractBehavior} from "@/common/behaviors/AbstractBehavior.js";
export {StaticBehavior} from "@/common/behaviors/StaticBehavior.js";
export {MachineBehavior} from "@/sim/behaviors/MachineBehavior.js";
export {ExtractorBehavior} from "@/sim/behaviors/ExtractorBehavior.js";
export {GeneratorBehavior} from "@/sim/behaviors/GeneratorBehavior.js";
export {ResourceBehavior} from "@/sim/behaviors/ResourceBehavior.js";
export {RoadBehavior} from "@/sim/behaviors/RoadBehavior.js";
export {HousingBehavior} from "@/sim/behaviors/HousingBehavior.js";
export {TickPhase} from "@/sim/GameEngine.js";
export {EMPTY, NO_EID} from "@/sim/sentinels.js";

// ---- Engine events ----
// Chunk subscribe/unsubscribe events, so a mod's client side can react to chunks
// entering/leaving a session's viewport.
// TickEndEvent lands on every session every tick, carrying the world clock — a mod reads the tick
// it is in from that, or from the `clock` cache namespace on the client.
export {
    ChunkSubscribeEvent,
    ChunkUnsubscribeEvent,
    TickEndEvent,
} from "@/common/CoreEvents.js";

// ---- Messages ----
// Base class for messages a session sends to the game (player intents). Subclass
// it, declare a static `wireFields` map, and optionally override `validate`.
export {AbstractMessage} from "@/common/AbstractMessage.js";

// Generic "delete the object with this id" message; the engine's PlacedObjects host despawns the
// entity. Lets a tool remove any object without knowing which mod owns it.
export {DeleteObjectMessage} from "@/common/CoreMessages.js";

// Generic object-placement message (tagged with an ObjectType's typeId) and the generic object
// lifecycle events PlacedObjects emits — a mod uses these instead of per-object classes.
export {CreateObjectMessage} from "@/common/CoreMessages.js";
export {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";

// The core player intents a mod's client side (or its specs) may send: viewport subscription,
// chunk claiming, friend list edits, and a player-setting write.
export {SetViewportMessage} from "@/common/CoreMessages.js";
export {ClaimChunkMessage} from "@/common/ClaimMessages.js";
export {AddFriendMessage, RemoveFriendMessage, SetPlayerSettingMessage} from "@/common/PlayerMessages.js";

// ---- Events ----
// Base classes for events a mod emits to connected clients (rendering, effects).
// Subclasses must declare a static `wireFields` map. Extend `AbstractChunkRoutedEvent`
// for an event tied to a tile (adds x, y and a derived `chunk`); extend `AbstractEvent`
// for one with no position.
export {AbstractEvent} from "@/common/AbstractEvent.js";
export {AbstractChunkRoutedEvent} from "@/common/AbstractChunkRoutedEvent.js";
export {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";

// Engine render deltas for the item resting in a render-flagged out-port.
export {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";

// The joining session's own identity, and the friend list a mod may gate on.
export {WelcomeEvent, FriendListEvent} from "@/common/PlayerEvents.js";

// Per-key player-setting delta, for a mod reacting to a setting flipping mid-session.
export {PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";

// Worker assignment deltas/sync the engine's WorkerNetworks emits (NO_HOUSING = unmanned).
export {WorkerAssignmentEvent, WorkerAssignmentSyncEvent, WorkerAssignmentBatchEvent, NO_HOUSING} from "@/common/WorkerEvents.js";

// ---- World geometry ----
// `Direction` is the cardinal-direction enum (with rotate/dx/dy helpers).
// `CHUNK_SIZE` is the width/height of a chunk in tiles.
export {
    Direction,
    CHUNK_SIZE,
    LAYER_SURFACE,
} from "@/common/constants.js";

// The unowned/anonymous player id: no session owns the action.
export {PLAYER_ID_NONE} from "@/common/constants.js";

// ---- Logic network ----
// Machine on/off, readable and writable through AbstractBehavior.logicRead/logicWrite;
// LOGIC_KEY_PROCESSING reads whether a craft is in flight and is never writable.
export {LOGIC_KEY_ENABLED, LOGIC_KEY_PROCESSING} from "@/common/constants.js";
// UI metadata a declaration's logicKeys map carries per key (name + optional on/off states).
export {LogicKeyEntry, LogicKeyState} from "@/common/LogicKeys.js";

// ---- Player settings ----
// Per-key player-setting config a declaration contributes (playerSettingEntries); only
// clientWritable keys accept a SetPlayerSettingMessage, holding an integer in
// [0, optionCount). Toggle values: 0/absent = on.
export {PlayerSettingEntry} from "@/common/PlayerSettingEntry.js";
export {SETTING_ON, SETTING_OFF} from "@/common/constants.js";

// ---- Market ----
// Item type -> tradable-catalog listing a declaration contributes (marketListings); npcPrice null
// means player-market-only (no fixed NPC price).
export {MarketListingEntry} from "@/common/MarketListingEntry.js";

// ---- Metrics ----
// GLOBAL-scope query opt-in a declaration contributes (metricsGlobalQueries); rowFilter trims a
// public answer's rows (e.g. one side of each trade).
export {MetricsGlobalQueryEntry} from "@/common/MetricsGlobalQueryEntry.js";

// ---- Items ----
// Item definition a declaration contributes inside an ItemCategory (items): a player-visible name
// plus a texture name and a pixi multiply tint, so shared shapes stay visually distinct per item
// type. The frozen ModRegistry merges them into its ItemRegistry (modRegistry.items).
export {ItemDefinition} from "@/common/ItemDefinition.js";
// Collection-log section a declaration contributes (items); same-name categories merge across the
// loadout and sort by name (modRegistry.itemCategories).
export {ItemCategory} from "@/common/ItemCategory.js";

// An item count or currency amount as at most five characters (99999, 9999K, 999M, 1B).
export {formatCount} from "@/common/util.js";

// Rotates a `{x, y}` offset (a port or size vector) by a placement direction, so a mod
// can compute where an object's ports/geometry land from its ObjectType.
export {rotate} from "@/common/util.js";

// ---- World noise ----
// Mods declare NoiseChannels (declaration.noiseChannels); `game.noise` on the sim and `client.noise`
// on the client sample them by channelId, both seeded by GameSettingsKey.SEED so terrain derives
// identically on either side.
export {NoiseChannel} from "@/common/NoiseChannel.js";
export {WorldNoise, tileHash} from "@/common/WorldNoise.js";

// Mods declare Biomes (declaration.biomes) selected by NoiseRanges over their channels;
// `game.terrain` / `client.terrain` resolve tile -> biomeId and bake chunks (docs/terrain-rendering.md).
export {Biome, NoiseRange, TerrainDetail} from "@/common/Biome.js";
export {Terrain, TerrainBake, TileBiome} from "@/common/Terrain.js";
export {GameSettingsKey} from "@/common/constants.js";

// ---- Chunk ids ----
// A chunk is identified by an integer ordinal id (its index within the region);
// `chunkId(tileX, tileY)` computes that id in JS.
export {chunkId, chunkOrigin} from "@/common/util.js";

// The id of a tile, used as the key of every spatial index.
export {tileId} from "@/common/util.js";

// Half the region's tile span; the world's half-open coordinate box is [-TILE_HALF, TILE_HALF).
export {TILE_HALF} from "@/common/util.js";

// Holds a value between two bounds; an inverted range collapses to its low end.
export {clamp} from "@/common/util.js";

// The map value under a key, created on first use.
export {getOrCreate} from "@/common/util.js";

// Drops a member from a Map<*, Set>, deleting the key once its set empties.
export {removeFromGroup} from "@/common/util.js";

// ---- Wire ----
// Encodes/decodes the registry's wire classes; a mod's spec round-trips its own events through it.
export {WireRegistry} from "@/common/wire.js";

// ---- Textures ----
// One texture atlas (image + frame data) a mod package ships; built by the mod's loader, not by
// its declaration.
export {TextureAtlas} from "@/common/TextureAtlas.js";
