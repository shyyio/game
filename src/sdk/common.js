// Mod SDK — engine-agnostic surface.
//
// This is the stable, documented API that mods bind to instead of reaching into
// engine internals. It imports only from `src/common/`, so it
// runs identically on client and server. Mods import it as `@/sdk/common.js`.
//
// Mod anatomy — a mod is a ModPackage of up to three parts:
//   declaration.js — an AbstractModDeclaration: pure data (objectTypes, wireClasses, textures,
//       itemTextures). Most mods are declaration-only: each ObjectType bundles its geometry/ports
//       with a behavior (a component+system bundle) and the engine derives the whole sim and
//       client surface from it.
//   sim.js (optional) — an AbstractSimMod for bespoke sim content, in ECS terms: define components
//       (sim.defineComponent), register per-phase systems (sim.registerSystem(phase, fn, order)),
//       handle spawn/despawn messages (sim.registerMessageHandler). Share instances across mods
//       via sim.provide(ServiceKey, instance) / sim.resolve(ServiceKey).
//   client.js (optional) — an AbstractClientMod for bespoke rendering/input (see @/sdk/client.js).
//
// Lifecycle: register the loadout's packages into a ModRegistry, freeze() it once (assigning every
// ObjectType its positional typeId and every wire class its wireId), then build the GameEngine /
// Client on the frozen registry. Both build sites share `src/mods/loadout.js`, so the positional
// ids always match between sim and client.
//
// Client-only API (draw layers, tools, pixi types) lives in `@/sdk/client.js`,
// which re-exports everything here. Everything a mod is meant to use should be
// reachable from these two files and nowhere else.

// ---- Mod framework ----
// A mod is a ModPackage: a pure-data declaration (object types, wire classes, textures) plus an
// optional sim part and an optional client part, registered into a ModRegistry and frozen once.
export {AbstractModDeclaration} from "@/common/mod/AbstractModDeclaration.js";
export {ModPackage} from "@/common/mod/ModPackage.js";
export {ModRegistry} from "@/common/mod/ModRegistry.js";
export {AbstractSimMod} from "@/common/sim/AbstractSimMod.js";
export {
    ObjectType,       // the entity blueprint for a placeable: ports, geometry, behavior, rules
    PortDefinition,   // one input/output/internal port on an object (position + facing)
    RecipeDefinition, // one recipe: a consumed input set mapping to an output item
    PlacementRule,    // how an object type may be placed (overwrite/advance/placeOn/solid)
    MenuVerb,         // one derived mini-menu action on an object type
    InspectVerb,
    DeleteVerb,
    MiniMenuEntry,    // one entry in the right-click / long-press context menu
} from "@/common/ObjectType.js";

// ---- Sim behaviors ----
// Component+system bundles a declaration plugs into an ObjectType's `behavior` slot; the engine's
// PlacedObjects host derives the whole entity lifecycle from them. TickPhase is the enum of the
// per-tick phases systems are scheduled into.
export {
    AbstractBehavior,
    StaticBehavior,
    MachineBehavior,
    ExtractorBehavior,
    ResourceBehavior,
} from "@/common/sim/behaviors.js";
export {TickPhase, EMPTY, NO_EID} from "@/common/sim/GameEngine.js";

// ---- Engine events ----
// Chunk subscribe/unsubscribe events, so a mod's client side can react to chunks
// entering/leaving a session's viewport.
export {
    ChunkSubscribeEvent,
    ChunkUnsubscribeEvent,
} from "@/common/CoreEvents.js";

// ---- Messages ----
// Base class for messages a session sends to the game (player intents). Subclass
// it, declare a static `wireFields` map, and optionally override `validate`.
export {AbstractMessage} from "@/common/AbstractMessage.js";

// Generic "delete the object with this id" message; the engine's PlacedObjects host despawns any
// derived entity, and bespoke handlers (belts) take the ids they own. Lets a tool remove any
// object without knowing which mod owns it.
export {DeleteObjectMessage} from "@/common/CoreMessages.js";

// Generic object-placement message (tagged with an ObjectType's typeId) and the generic object
// lifecycle events PlacedObjects emits — a mod uses these instead of per-object classes.
export {CreateObjectMessage} from "@/common/CoreMessages.js";
export {ObjectInsertEvent, ObjectSyncEvent, ObjectDeleteEvent} from "@/common/ObjectEvents.js";

// ---- Events ----
// Base classes for events a mod emits to connected clients (rendering, effects).
// Subclasses must declare a static `wireFields` map. Extend `AbstractTilePositionedEvent`
// for an event tied to a tile (adds x, y and a derived `chunk`); extend `AbstractEvent`
// for one with no position.
export {AbstractEvent} from "@/common/AbstractEvent.js";
export {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";

// Engine render deltas for the item resting in a render-flagged out-port.
export {PortItemSetEvent, PortItemClearEvent} from "@/common/PortItemEvents.js";

// ---- World geometry ----
// `Direction` is the cardinal-direction enum (with rotate/dx/dy helpers).
// `CHUNK_SIZE` is the width/height of a chunk in tiles.
export {
    Direction,
    CHUNK_SIZE,
    LAYER_SURFACE,
} from "@/common/constants.js";

// Rotates a `{x, y}` offset (a port or size vector) by a placement direction, so a mod
// can compute where an object's ports/geometry land from its ObjectType.
export {rotate} from "@/common/util.js";

// ---- Chunk ids ----
// A chunk is identified by an integer ordinal id (its index within the region);
// `chunkId(tileX, tileY)` computes that id in JS.
export {chunkId} from "@/common/util.js";

// ---- Textures ----
// Describes a texture atlas (image + frame data) a mod contributes.
export {TextureDefinition} from "@/common/TextureDefinition.js";
