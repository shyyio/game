// Mod SDK — engine-agnostic surface.
//
// This is the stable, documented API that mods bind to instead of reaching into
// engine internals. It imports only from `src/common/`, so it
// runs identically on client and server. Mods import it as `@/sdk/common.js`.
//
// Client-only API (draw layers, tools, pixi types) lives in `@/sdk/client.js`,
// which re-exports everything here. Everything a mod is meant to use should be
// reachable from these two files and nowhere else.

// ---- Mod framework ----
// The building blocks of a mod. `AbstractMod` is the base class you extend; the rest
// describe the game objects your mod adds and how they behave each tick.
export {
    AbstractMod,              // base class every mod extends
    ObjectDefinition, // declares a placeable object: ports, geometry, per-tick ops
    PortDefinition,   // one input/output/internal port on an object (position + facing)
    RecipeDefinition, // one verb recipe: an input item set mapping to an output item
    SqlStatement,           // a SQL statement run during one tick phase
    TickPhase,        // enum of the per-tick phases ops are scheduled into
    MiniMenuEntry,    // one entry in the right-click / long-press context menu
} from "@/common/core.js";

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

// Generic "delete the object with this id" message, dispatched to every mod; a mod deletes
// the object if it owns the id and ignores it otherwise. Lets a tool remove any object
// (belt, splitter, machine, …) without knowing which mod owns it.
export {DeleteObjectMessage} from "@/common/CoreMessages.js";

// Generic object-placement message (tagged with an ObjectDefinition table name) and the generic
// object lifecycle events EasyObjectPlacement emits — a mod uses these instead of per-object classes.
export {CreateObjectMessage} from "@/common/CoreMessages.js";
export {EasyObjectInsertEvent, EasyObjectSyncEvent, EasyObjectDeleteEvent} from "@/common/EasyObjectEvents.js";

// ---- Errors ----
// Thrown by a mod's placement code to refuse a creation; unwinds to the transaction
// owner, which rolls back exactly once (so nested creations stay all-or-nothing).
export {PlacementRejected} from "@/common/error.js";

// ---- Events ----
// Base classes for events a mod emits to connected clients (rendering, effects).
// Subclasses must declare a static `wireFields` map. Extend `AbstractTilePositionedEvent`
// for an event tied to a tile (adds x, y and a derived `chunk`); extend `AbstractEvent`
// for one with no position.
export {AbstractEvent} from "@/common/AbstractEvent.js";
export {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";

// A drained BufferedEvent row; a mod's draw layer filters by `type` to react to tick events.
export {BufferedEvent} from "@/common/BufferedEvent.js";

// ---- World geometry ----
// `Direction` is the cardinal-direction enum (with rotate/dx/dy helpers).
// `CHUNK_SIZE` is the width/height of a chunk in tiles.
export {
    Direction,
    CHUNK_SIZE,
    OCCUPANCY_LAYER_SURFACE,
    OCCUPANCY_LAYER_RESOURCE,
    BUFFERED_EVENT_TYPE_PORT_ITEM_SET,
    BUFFERED_EVENT_TYPE_PORT_ITEM_CLEAR,
} from "@/common/constants.js";

// ---- Port wiring ----
// Helpers for connecting a freshly placed object to its neighbors. "Upstream"
// = the neighbor OUTPUT ports that feed this object's inputs; "downstream" =
// the neighbor INPUT ports this object's outputs feed. Both return a map of
// { thisObjectsPortName -> sharedPortId }.
export {upstreamPorts, downstreamPorts} from "@/common/portUtils.js";

// Sim-side create/remove/sync flow for a port-sharing object placed by a Create<T>Message; a mod
// composes one per object type and delegates onMessage/chunkSyncEvents to it. "Easy" = the
// base-case helper most mods build on (vs bespoke belt placement).
export {EasyObjectPlacement} from "@/common/EasyObjectPlacement.js";

// Base-case machine behavior: implement one verb over the shared Recipes table — gather one input per
// port, match the set (fallback when none), then after a countdown create the output, all via transfer
// intents. Build it, then `install(definition)` to set the definition's verb/tickPhases/stateColumns.
export {EasyRecipeProcessor} from "@/common/EasyRecipeProcessor.js";

// Sim-side place/remove/sync for a passive, portless resource an extractor draws from; wraps an
// EasyObjectPlacement and contributes a ResourceCoverAt fragment mapping extraction tiles to a type.
export {EasyResource} from "@/common/EasyResource.js";

// Base-case extractor: a producer whose fixed input is the resource under it (bound at placement),
// looked up in the verb's Recipes and produced on a countdown. Build it, then `install(definition)`.
export {EasyExtractor} from "@/common/EasyExtractor.js";

// Rotates a `{x, y}` offset (a port or size vector) by a placement direction, so a mod
// can compute where an object's ports/geometry land from its ObjectDefinition.
export {rotate} from "@/common/util.js";

// ---- Chunk ids ----
// A chunk is identified by an integer ordinal id (its index within the region).
// `chunkId(tileX, tileY)` computes that id in JS; `CHUNK_ID_SQL` is the equivalent
// SQL expression for use inside a mod's table schema (e.g. a generated `chunk`
// column).
export {chunkId} from "@/common/util.js";
export {CHUNK_ID_SQL, CHUNK_COORD_SQL} from "@/common/DatabaseSchema.js";

// ---- Textures ----
// Describes a texture atlas (image + frame data) a mod contributes.
export {TextureDefinition} from "@/common/TextureDefinition.js";
