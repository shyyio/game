// Mod SDK — client-only surface.
//
// Re-exports `@/sdk/common.js` plus the browser-only pieces a client mod needs; sim-side mod
// files import from common.js, rendering/input files import from here.
//
// A declaration-only mod needs nothing from this file: the client derives a draw layer, ghost,
// and tool per ObjectType automatically. AbstractClientMod is only for bespoke rendering/input.

// Everything from the engine-agnostic SDK is available here too.
export * from "@/sdk/common.js";

// ---- Mod framework ----
// The optional client part of a ModPackage: draw layers, tools, and input hooks.
export {AbstractClientMod} from "@/client/AbstractClientMod.js";

// ---- Rendering ----
// Base class for a Pixi layer that reacts to game events.
export {AbstractDrawLayer} from "@/client/layers/AbstractDrawLayer.js";
// `AbstractChunkedDrawLayer` adds per-chunk grouping: ChunkNode roots mounted by viewport,
// one-pass stale-chunk rebuilds, and the map-mode sprite/geometry swap.
export {AbstractChunkedDrawLayer} from "@/client/layers/AbstractChunkedDrawLayer.js";

// Debug overlays: visible only in debug mode, repainted lazily via markStale.
export {AbstractDebugDrawLayer} from "@/client/layers/AbstractDebugDrawLayer.js";
// Draws each chunk as one AnimatedTileMesh off a shared shader.
export {AbstractTileMeshDrawLayer} from "@/client/layers/AbstractTileMeshDrawLayer.js";
// Derived-default renderer for a placed object type, driven by the shared cache.
export {ObjectDrawLayer} from "@/client/layers/ObjectDrawLayer.js";
// The `data` payload of a derived-type cache entry ({type, direction}).
export {ObjectClientData} from "@/client/state/ObjectsState.js";
// The base-case object sprite (static, geometry-centered); the derived layers build it from a texture.
export {ObjectSprite} from "@/client/layers/ObjectSprite.js";
// The single shared item layer; mods that compute item positions (belts) drive it via
// `client.itemLayer`. PORT_SPRITE_KEY namespaces resting out-port item sprites.
export {ItemDrawLayer, PORT_SPRITE_KEY} from "@/client/layers/ItemDrawLayer.js";
// The single shared connection-stub layer; a mod opts in via ObjectType.renderConnections.
export {ConnectionDrawLayer} from "@/client/layers/ConnectionDrawLayer.js";
// The derived-default placement-preview ghost (single sprite + center-lock); paired with ObjectTool.
export {ObjectGhostLayer} from "@/client/layers/ObjectGhostLayer.js";

// ---- HUD panel look-and-feel ----
// Same framed-panel toolkit the core Friends/Inspect panels use, for a mod-contributed HUD panel.
export {UIPanel, ManagedPanel} from "@/client/hud/UIPanel.js";
export {buildPanelButton, buildToggleRow, BUTTON_HEIGHT} from "@/client/hud/panelButton.js";
export {PANEL_TINT, PANEL_TITLE_TEXT, ACTIVE_ACCENT, TOOLBAR_TEXT} from "@/client/Theme.js";
// A curved line from a HUD panel to the tile it targets (used by the core Inspect panel).
export {rectEdgePoint, drawPanelConnector, CONNECTOR_PANEL_INSET} from "@/client/hud/PanelConnector.js";
// Declarative panel-body builder (header/text/row/scrollSection) for use with UIPanel.managed.
export {PanelStack, PanelRowDescriptor, ROW_HEIGHT, ROW_GAP} from "@/client/hud/PanelStack.js";
export {panelText, TextRole} from "@/client/hud/PanelText.js";
export {ConnectedPanelLayer} from "@/client/hud/ConnectedPanelLayer.js";
// Masked, scrollable viewport with a draggable thumb, for a scroll region outside PanelStack.scrollSection.
export {ScrollView} from "@/client/hud/ScrollView.js";

// ---- Settings menu ----
// Declarative settings-menu controls, returned from a client mod's settingsCategories hook.
export {AbstractSettingControl} from "@/client/hud/AbstractSettingControl.js";
export {AbstractPlayerSettingControl} from "@/client/hud/AbstractPlayerSettingControl.js";
export {SettingCategory} from "@/client/hud/SettingCategory.js";
export {PlayerSettingToggle} from "@/client/hud/PlayerSettingToggle.js";
export {PlayerSettingChoice} from "@/client/hud/PlayerSettingChoice.js";
export {DeviceSettingToggle} from "@/client/hud/DeviceSettingToggle.js";

// ---- Input ----
// Base class for a placement/interaction tool shown in the toolbar.
export {AbstractTool} from "@/client/input/AbstractTool.js";
// The derived-default tap-to-place tool (with center-lock); knobs come from the type's PlacementRule.
export {ObjectTool} from "@/client/input/ObjectTool.js";
// The shared pointer singleton; ghost layers read `currentX`/`currentY` (world coordinates) to float on the cursor.
export {default as Mouse} from "@/client/input/Mouse.js";

// A page-lifetime repeating timer, so a mod's heartbeat never names a page global.
export {startHeartbeat} from "@/client/timers.js";

// Singleton tracking window focus + tab visibility as one `focused` boolean.
export {default as WindowFocus} from "@/client/WindowFocus.js";

// ---- Feedback ----
// Haptic (rumble) feedback for touch devices; a no-op where unavailable.
export {default as Haptics} from "@/client/Haptics.js";

// One inspect-hover highlight (an object outlined at a tile), returned in arrays from a mod's onInspect.
export {InspectHighlight} from "@/client/layers/InspectHighlight.js";

// ---- Client world state ----
// The shared plain-data state tree (`client.cache`); namespaces register schema/writer/view via
// `client.cache.register(name, schema, writer, view)`, reached via cache.writer(name)/cache.view(name).
export {ClientCache, AbstractCacheWriter, AbstractCacheView, schemaScalar, schemaMap, schemaSet} from "@/client/state/ClientCache.js";
// The core namespaces' views, for typing and the static helpers.
export {ChunkClaimsView} from "@/client/state/ChunkClaimsState.js";
export {PlayerSettingsView, GameSettingsView} from "@/client/state/SettingsState.js";
// The core namespaces' writers + schemas, for composing a standalone cache in a mod spec.
export {ChunkClaimsWriter, CHUNK_CLAIMS_SCHEMA} from "@/client/state/ChunkClaimsState.js";
export {PlayerSettingsWriter, PLAYER_SETTINGS_SCHEMA} from "@/client/state/SettingsState.js";
export {WorkerAssignmentsView} from "@/client/state/WorkerAssignmentsState.js";
// The sim clock as the server last reported it: `client.cache.view("clock").tick()`, updated by the
// per-tick heartbeat, or subscribe to "clock.tick".
export {ClockView, ClockWriter, CLOCK_SCHEMA} from "@/client/state/ClockState.js";
export {OverworldView} from "@/client/state/OverworldState.js";

// The objects namespace's view doubles as the shared cross-mod spatial index; reached via
// `client.objects` and injected into draw layers as `this.cache`, instead of querying the sim DB.
export {ObjectsView, CacheEntry} from "@/client/state/ObjectsState.js";


// ---- Pixel-space geometry ----
// `TILE_SIZE` is a tile's size in pixels; the snap helpers round pixel coordinates to tile/chunk boundaries.
export {TILE_SIZE, snapToTile, snapToChunk} from "@/client/constants.js";

// The zoom-driven view mode (world sprites / map geometry / baked overworld).
export {ViewMode} from "@/client/constants.js";

// The shared UI font, for debug/overlay labels.
export {GAME_FONT} from "@/client/constants.js";

// Compares a layer's mounted chunks against the visible set handed to `tick`.
export {sameChunks} from "@/client/constants.js";

// Groups a chunk's sprites and pooled map geometry under one mountable root.
export {ChunkNode} from "@/client/layers/ChunkNode.js";

// ---- Drawing helpers ----
// Convenience wrappers for drawing onto a Pixi Graphics object.
export {drawLine, drawRect, drawCircle} from "@/client/layers/pixiUtils.js";

// `DEBUG_COLOR(n)` maps a numeric id to a stable color from a fixed debug palette.
export {DEBUG_COLOR} from "@/client/Theme.js";

// Stable per-player accent color (also used for claim borders).
export {claimColor} from "@/client/Theme.js";

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
// Shared mod-8 animation clock: frames named "<base>/0".."<base>/7"; currentAnimationFrame() keeps all mods in lockstep.
export {currentAnimationFrame} from "@/client/layers/animation.js";

// Scalar tween + easing curves, and display-object pooling for layers that churn sprites.
export {Tween, linear, easeOutBack, easeInCubic} from "@/client/layers/Tween.js";
export {DisplayPool} from "@/client/layers/DisplayPool.js";
export {KeyedDisplayPool} from "@/client/layers/KeyedDisplayPool.js";

// Draws a group of animated tiles as one mesh, advancing frames via a single uniform write.
export {AnimatedTile, AnimatedTileMesh, AnimatedTileShader, FrameTable} from "@/client/layers/AnimatedTileMesh.js";

// ---- Pixi types ----
// Passed through so mods share the engine's single Pixi instance (multiple copies break rendering).
export {Graphics, Rectangle, Sprite, Text, Texture, Container} from "pixi.js";
