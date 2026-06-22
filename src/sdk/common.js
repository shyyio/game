// Mod SDK — engine-agnostic surface.
//
// This is the stable, documented API that mods bind to instead of reaching into
// engine internals. It imports only from `src/common/` and `src/util.js`, so it
// runs identically on client and server. A future runtime mod loader exposes
// this module to zip-installed mods via an import map (bare specifier "pipesjs");
// built-in mods import it as `@/sdk/common.js`.
//
// Client-only API (draw layers, tools, pixi types) lives in `@/sdk/client.js`,
// which re-exports everything here. Everything a mod is meant to use should be
// reachable from these two files and nowhere else.

// ---- Mod framework ----
// The building blocks of a mod. `Mod` is the base class you extend; the rest
// describe the game objects your mod adds and how they behave each tick.
export {
    Mod,              // base class every mod extends
    ObjectDefinition, // declares a placeable object: ports, footprint, per-tick ops
    PortDefinition,   // one input/output/internal port on an object (position + facing)
    TickOp,           // a SQL statement run during one tick phase
    PortTransferOp,   // a TickOp that moves an item from one port to another
    TickPhase,        // enum of the per-tick phases ops are scheduled into
    MiniMenuEntry,    // one entry in the right-click / long-press context menu
} from "@/common/core.js";

// ---- Events ----
// Base class for events a mod emits to connected clients (rendering, effects).
export {LiveEvent} from "@/common/LiveEvent.js";

// ---- World geometry ----
// `Direction` is the cardinal-direction enum (with rotate/dx/dy helpers).
// `CHUNK_SIZE` is the width/height of a chunk in tiles.
export {Direction, CHUNK_SIZE} from "@/common/constants.js";

// ---- Port wiring ----
// Helpers for connecting a freshly placed object to its neighbours. "Upstream"
// = the neighbour OUTPUT ports that feed this object's inputs; "downstream" =
// the neighbour INPUT ports this object's outputs feed. Both return a map of
// { thisObjectsPortName -> sharedPortId }. `createInternalPorts` allocates new
// ports an object owns internally (not shared with neighbours).
export {upstreamPorts, downstreamPorts, createInternalPorts, objectTiles} from "@/common/portUtils.js";

// ---- Chunk keys ----
// A chunk is identified by a "x,y" string key (NOT an object). `chunkKey(tileX,
// tileY)` computes that key in JS; `CHUNK_KEY_SQL` is the equivalent SQL
// expression for use inside a mod's table schema (e.g. a generated `chunk`
// column).
export {chunkKey} from "@/common/util.js";
export {CHUNK_KEY_SQL} from "@/common/DatabaseSchema.js";

// ---- Textures ----
// Describes a texture atlas (image + frame data) a mod contributes.
export {TextureDefinition} from "@/common/TextureDefinition.js";
