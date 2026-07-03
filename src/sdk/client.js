// Mod SDK — client-only surface.
//
// Re-exports the full engine-agnostic API (`@/sdk/common.js`) plus the
// browser-only pieces a client mod needs. Simulation-side mod files (the parts
// that run on both client and server) import from `@/sdk/common.js`; files that
// render or handle input import from here.

// Everything from the engine-agnostic SDK is available here too.
export * from "@/sdk/common.js";

// ---- Rendering ----
// `AbstractDrawLayer` is the base class for a Pixi layer that reacts to game events;
// `EasyObjectDrawLayer` is the base-case layer a mod composes to render a placed object type from
// the generic object events (cache + sprite + chunk lifecycle, all handled).
export {AbstractDrawLayer} from "@/client/AbstractDrawLayer.js";
export {EasyObjectDrawLayer} from "@/client/EasyObjectDrawLayer.js";
// The base-case object sprite (static, geometry-centered); EasyObject layers build it from a texture.
export {EasySprite} from "@/client/EasySprite.js";
// The single shared item layer; mods that compute item positions (belts) drive it via
// `client.itemLayer`. PORT_SPRITE_KEY namespaces resting out-port item sprites.
export {ItemDrawLayer, PORT_SPRITE_KEY} from "@/client/ItemDrawLayer.js";
// The single shared connection-stub layer; a mod opts in via ObjectDefinition.renderConnections.
export {ConnectionDrawLayer} from "@/client/ConnectionDrawLayer.js";
// The base-case placement-preview ghost (single sprite + center-lock); paired with EasyObjectTool.
export {EasyObjectGhostLayer} from "@/client/EasyObjectGhostLayer.js";

// ---- Input ----
// Base class for a placement/interaction tool shown in the toolbar.
export {AbstractTool} from "@/client/AbstractTool.js";
// The base-case tap-to-place tool (with center-lock); a mod composes it for a simple object.
export {EasyObjectTool} from "@/client/EasyObjectTool.js";

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

// ---- Pixi types ----
// Passed through so mods share the engine's single Pixi instance rather than
// bundling their own (multiple Pixi copies break rendering).
export {Graphics, Rectangle, Sprite, Texture, Container} from "pixi.js";
