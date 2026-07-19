// Mod SDK — client-only surface.
//
// Re-exports the full engine-agnostic API (`@/sdk/common.js`) plus the
// browser-only pieces a client mod needs. Simulation-side mod files (the parts
// that run on both client and server) import from `@/sdk/common.js`; files that
// render or handle input import from here.
//
// A declaration-only mod needs nothing from this file: for every ObjectType with a behavior the
// client derives a draw layer, placement ghost, and tool (overridable per piece via the type's
// createDrawLayer/createGhostLayer/createTool hooks), keeps the shared cache in sync, and derives
// inspect highlights and mini-menu entries from the type's menuVerbs. An AbstractClientMod is only
// for bespoke rendering/input (belts); every hook receives the client for the shared surfaces
// (client.cache, client.itemLayer, client.session, ...).

// Everything from the engine-agnostic SDK is available here too.
export * from "@/sdk/common.js";

// ---- Mod framework ----
// The optional client part of a ModPackage: draw layers, tools, and input hooks.
export {AbstractClientMod} from "@/client/AbstractClientMod.js";

// ---- Rendering ----
// `AbstractDrawLayer` is the base class for a Pixi layer that reacts to game events;
// `ObjectDrawLayer` is the derived-default renderer for a placed object type, driven purely by the
// shared cache (ClientCacheSync owns the entries). A type swaps it via `createDrawLayer(client)`.
export {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
export {ObjectDrawLayer} from "@/client/ObjectDrawLayer.js";
// The `data` payload of a derived-type cache entry ({type, direction}).
export {ObjectClientData} from "@/client/ClientCacheSync.js";
// The base-case object sprite (static, geometry-centered); the derived layers build it from a texture.
export {ObjectSprite} from "@/client/ObjectSprite.js";
// The single shared item layer; mods that compute item positions (belts) drive it via
// `client.itemLayer`. PORT_SPRITE_KEY namespaces resting out-port item sprites.
export {ItemDrawLayer, PORT_SPRITE_KEY} from "@/client/ItemDrawLayer.js";
// The single shared connection-stub layer; a mod opts in via ObjectType.renderConnections.
export {ConnectionDrawLayer} from "@/client/ConnectionDrawLayer.js";
// The derived-default placement-preview ghost (single sprite + center-lock); paired with ObjectTool.
export {ObjectGhostLayer} from "@/client/ObjectGhostLayer.js";

// ---- Input ----
// Base class for a placement/interaction tool shown in the toolbar.
export {AbstractTool} from "@/client/AbstractTool.js";
// The derived-default tap-to-place tool (with center-lock); knobs come from the type's PlacementRule.
export {ObjectTool} from "@/client/ObjectTool.js";
// The shared pointer singleton; ghost layers read `currentX`/`currentY` (world coordinates) to float on the cursor.
export {default as Mouse} from "@/client/Mouse.js";

// ---- Feedback ----
// Haptic (rumble) feedback for touch devices; a no-op where unavailable.
export {default as Haptics} from "@/client/Haptics.js";

// One inspect-hover highlight (an object outlined at a tile), returned in arrays from a mod's onInspect.
export {InspectHighlight} from "@/client/InspectHighlight.js";

// ---- Client world state ----
// The shared cross-mod index of placed objects (a CacheEntry each, by id, primary tile,
// chunk, tile+layer cell, and rendered out-port id), reached via `client.cache` and injected
// into draw layers as `this.cache`. Mods feed it from their insert/delete handling; client
// code queries it instead of the simulation DB (tile lookups, placement collision, connection).
// Holds a `CacheEntry` per object, also indexed by rendered out-port id.
export {ClientCache, CacheEntry} from "@/client/ClientCache.js";


// ---- Pixel-space geometry ----
// `TILE_SIZE` is a tile's size in pixels; the snap helpers round pixel
// coordinates to tile/chunk boundaries. (CHUNK_SIZE comes from the common SDK —
// it is measured in tiles, not pixels, so it is not re-exported here.)
export {TILE_SIZE, snapToTile, snapToChunk} from "@/client/constants.js";

// Compares a layer's mounted chunks against the visible set handed to `tick`, for layers that cull
// their children — pixi walks every child of a container each frame.
export {sameChunks} from "@/client/constants.js";

// Groups a chunk's sprites and pooled map geometry under one mountable root, so a layer mounts and
// unmounts per chunk instead of per sprite.
export {ChunkNode} from "@/client/ChunkNode.js";

// ---- Drawing helpers ----
// Convenience wrappers for drawing onto a Pixi Graphics object.
export {drawLine, drawRect, drawCircle} from "@/client/pixiUtils.js";

// `DEBUG_COLOR(n)` maps a numeric id to a stable color from a fixed debug palette.
export {DEBUG_COLOR} from "@/client/Theme.js";

// Shared placement-ghost palette + center-lock target-tile marker, for tool ghost layers.
export {
    GHOST_TINT,
    GHOST_BLOCKED_TINT,
    GHOST_BLOCKED_ALPHA,
    TARGET_TILE_COLOR,
    TARGET_TILE_FILL_ALPHA,
    TARGET_TILE_BORDER_WIDTH,
} from "@/client/Theme.js";

// ---- Animation ----
// Shared mod-8 animation clock: every animated sequence has 8 frames named
// "<base>/0".."<base>/7", and currentAnimationFrame() returns the single frame
// every sprite shows right now, keeping all mods in lockstep.
export {currentAnimationFrame} from "@/client/animation.js";

// Draws a group of animated tiles as one mesh whose vertices never change as the animation runs, so
// the whole group advances a frame with a single uniform write instead of a texture swap per sprite.
export {AnimatedTile, AnimatedTileMesh, AnimatedTileShader, FrameTable} from "@/client/AnimatedTileMesh.js";

// ---- Pixi types ----
// Passed through so mods share the engine's single Pixi instance rather than
// bundling their own (multiple Pixi copies break rendering).
export {Graphics, Rectangle, Sprite, Texture, Container} from "pixi.js";
