// Mod SDK — client-only surface.
//
// Re-exports the full engine-agnostic API (`@/sdk/common.js`) plus the
// browser-only pieces a client mod needs. Simulation-side mod files (the parts
// that run on both client and server) import from `@/sdk/common.js`; files that
// render or handle input import from here. A future zip's `client/index.js`
// resolves the bare specifier "pipesjs" to this module via an import map.

// Everything from the engine-agnostic SDK is available here too.
export * from "@/sdk/common.js";

// ---- Rendering ----
// `DrawLayer` is the base class for a Pixi layer that reacts to game events;
// `ObjectDrawLayer` is a ready-made layer for simple insert/update/delete object
// rendering.
export {DrawLayer} from "@/client/DrawLayer.js";
export {ObjectDrawLayer} from "@/client/ObjectDrawLayer.js";

// ---- Input ----
// Base class for a placement/interaction tool shown in the toolbar.
export {Tool} from "@/client/Tool.js";

// ---- Pixel-space geometry ----
// `TILE_SIZE` is a tile's size in pixels; the snap helpers round pixel
// coordinates to tile/chunk boundaries. (CHUNK_SIZE comes from the common SDK —
// it is measured in tiles, not pixels, so it is not re-exported here.)
export {TILE_SIZE, snapToTile, snapToChunk} from "@/client/constants.js";

// ---- Drawing helpers ----
// Convenience wrappers for drawing onto a Pixi Graphics object.
export {drawLine, drawRect, drawCircle} from "@/client/pixiUtils.js";

// ---- Pixi types ----
// Passed through so mods share the engine's single Pixi instance rather than
// bundling their own (multiple Pixi copies break rendering).
export {Graphics, Sprite, Texture, Container} from "pixi.js";
