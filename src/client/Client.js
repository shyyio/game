import Mouse from "@/client/input/Mouse.js";
import {TextureRegistry} from "@/client/layers/TextureRegistry.js";
import {SpriteOverrideStore} from "@/client/spriteEditor/SpriteOverrideStore.js";
import {DrawLayerRegistry} from "@/client/layers/DrawLayerRegistry.js";
import {InspectPanelLayer} from "@/client/hud/InspectPanelLayer.js";
import {RotateButtonsLayer} from "@/client/hud/RotateButtonsLayer.js";
import {ToolbarLayer} from "@/client/hud/ToolbarLayer.js";
import {ToolRotation} from "@/client/input/ToolRotation.js";
import {EraserTool} from "@/client/input/EraserTool.js";
import {SetViewportMessage, SetInspectedObjectsMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {ChunkSyncEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";
import {ClaimChunkMessage, UnclaimChunkMessage, SetChunkPermissionMessage} from "@/common/ClaimMessages.js";
import {NoticeLayer} from "@/client/hud/NoticeLayer.js";
import {ConfirmDialogLayer} from "@/client/hud/ConfirmDialogLayer.js";
import {ClaimResultFeedback} from "@/client/hud/ClaimResultFeedback.js";
import {
    AddFriendMessage, AddFriendByCodeMessage, RemoveFriendMessage, SetPlayerSettingMessage,
    SetPlayerSettingsToolOrderMessage,
} from "@/common/PlayerMessages.js";
import {applyToolOrder} from "@/client/input/ToolOrder.js";
import {SettingCategory} from "@/client/hud/SettingCategory.js";
import {AbstractPlayerSettingControl} from "@/client/hud/AbstractPlayerSettingControl.js";
import {PlayerSettingChoice} from "@/client/hud/PlayerSettingChoice.js";
import {PlayerSettingToggle} from "@/client/hud/PlayerSettingToggle.js";
import {DeviceSettingToggle} from "@/client/hud/DeviceSettingToggle.js";
import {DeviceSettingChoice} from "@/client/hud/DeviceSettingChoice.js";
import DeviceSettings, {
    DEVICE_SETTING_FULLSCREEN, DEVICE_SETTING_REDUCED_MOTION, DEVICE_SETTING_MOBILE,
    DEVICE_SETTING_THEME, DEVICE_SETTING_TERRAIN, DEVICE_SETTING_FPS_CAP,
} from "@/client/state/DeviceSettings.js";
import {applyTheme, onThemeChange, THEME_NAMES, THEME_DEFAULT} from "@/client/Theme.js";
import Fullscreen from "@/client/Fullscreen.js";
import ReducedMotion from "@/client/ReducedMotion.js";
import Mobile from "@/client/Mobile.js";
import SafeArea from "@/client/SafeArea.js";
import {ChunkClaimsDrawLayer} from "@/client/layers/ChunkClaimsDrawLayer.js";
import {ClientCache} from "@/client/state/ClientCache.js";
import {CHUNK_CLAIMS_SCHEMA, ChunkClaimsWriter, ChunkClaimsView} from "@/client/state/ChunkClaimsState.js";
import {PLAYERS_SCHEMA, PlayersWriter, PlayersView} from "@/client/state/PlayersState.js";
import {PLAYER_SETTINGS_SCHEMA, GAME_SETTINGS_SCHEMA, PlayerSettingsWriter, GameSettingsWriter, PlayerSettingsView, GameSettingsView} from "@/client/state/SettingsState.js";
import {WORKER_ASSIGNMENTS_SCHEMA, WorkerAssignmentsWriter, WorkerAssignmentsView} from "@/client/state/WorkerAssignmentsState.js";
import {METRICS_SCHEMA, MetricsWriter, MetricsView} from "@/client/state/MetricsState.js";
import {CLOCK_SCHEMA, ClockWriter, ClockView} from "@/client/state/ClockState.js";
import {METRICS_FACT_TYPE_ITEM_PRODUCED, METRICS_QUERY_SCOPE_OWN} from "@/common/MetricsFact.js";
import {MetricsSubscribeMessage, MetricsUnsubscribeMessage} from "@/common/MetricsMessages.js";
import {OBJECTS_SCHEMA, ObjectsWriter} from "@/client/state/ObjectsState.js";
import {INSPECT_SCHEMA, InspectWriter, InspectView} from "@/client/state/InspectState.js";
import {
    TILE_SIZE,
    snapToChunk,
    ViewportChunkWindow,
    ViewMode,
    MAP_MODE_SCALE_THRESHOLD,
    OVERWORLD_SCALE_THRESHOLD,
    OVERWORLD_CHUNK_TTL_MS,
    OVERWORLD_REFRESH_THROTTLE_MS,
    FRIENDS_PANEL_REFRESH_THROTTLE_MS,
    FPS_CAP_NAMES,
    FPS_CAP_VALUES,
    FPS_CAP_DEFAULT,
} from "@/client/constants.js";
import {CHUNK_SIZE, REGION_SIZE, Direction, GameSettingsKey} from "@/common/constants.js";
import {WorldNoise} from "@/common/WorldNoise.js";
import {Terrain} from "@/common/Terrain.js";
import {chunkCenter, chunkId, formatBytes, REGION_HALF} from "@/common/util.js";
import {OVERWORLD_SCHEMA, OverworldRect, OverworldWriter, OverworldView} from "@/client/state/OverworldState.js";
import {OverworldDrawLayer} from "@/client/layers/OverworldDrawLayer.js";
import {GridDrawLayer} from "@/client/layers/GridDrawLayer.js";
import {TerrainButtonLayer} from "@/client/hud/TerrainButtonLayer.js";
import {TerrainDrawLayer} from "@/client/layers/TerrainDrawLayer.js";
import {TerrainDetailLayer} from "@/client/layers/TerrainDetailLayer.js";
import {PlacementFeedbackLayer} from "@/client/layers/PlacementFeedbackLayer.js";
import {InspectLayer} from "@/client/layers/InspectLayer.js";
import {ItemInspectLayer} from "@/client/layers/ItemInspectLayer.js";
import {InspectTooltipLayer} from "@/client/hud/InspectTooltipLayer.js";
import {ObjectsView} from "@/client/state/ObjectsState.js";
import {ObjectTypeClientBundle} from "@/client/ObjectTypeClientBundle.js";
import {ObjectDrawLayer} from "@/client/layers/ObjectDrawLayer.js";
import {ObjectGhostLayer} from "@/client/layers/ObjectGhostLayer.js";
import {ObjectTool} from "@/client/input/ObjectTool.js";
import {InspectHighlight} from "@/client/layers/InspectHighlight.js";
import {ItemDrawLayer} from "@/client/layers/ItemDrawLayer.js";
import {ConnectionDrawLayer} from "@/client/layers/ConnectionDrawLayer.js";
import {WorkerDrawLayer} from "@/client/layers/WorkerDrawLayer.js";
import {WorkerDebugLayer} from "@/client/layers/WorkerDebugLayer.js";
import {WorkerBadgeLayer} from "@/client/layers/WorkerBadgeLayer.js";
import {CounterListLayer} from "@/client/hud/CounterListLayer.js";
import {CounterTooltip} from "@/client/hud/CounterTooltip.js";
import {StatusMessageLayer} from "@/client/hud/StatusMessageLayer.js";
import {VersionWatermarkLayer} from "@/client/hud/VersionWatermarkLayer.js";
import {TopStatusBarLayer} from "@/client/hud/TopStatusBarLayer.js";
import {BottomActionBarLayer} from "@/client/hud/BottomActionBarLayer.js";
import {SettingsButtonLayer} from "@/client/hud/SettingsButtonLayer.js";
import {FriendsButtonLayer} from "@/client/hud/FriendsButtonLayer.js";
import {ProductionButtonLayer} from "@/client/hud/ProductionButtonLayer.js";
import {ArtButtonLayer} from "@/client/hud/ArtButtonLayer.js";
import {ProductionPanelLayer} from "@/client/hud/ProductionPanelLayer.js";
import {FriendsPanelLayer} from "@/client/hud/FriendsPanelLayer.js";
import {ChunkActionsLayer} from "@/client/hud/ChunkActionsLayer.js";
import {ChunkSelectionLayer} from "@/client/layers/ChunkSelectionLayer.js";
import {ClaimFrontierDrawLayer} from "@/client/layers/ClaimFrontierDrawLayer.js";
import {ClaimSelectionMode} from "@/client/input/ClaimSelectionMode.js";
import {SettleFlow} from "@/client/input/SettleFlow.js";
import {ChunkCursor} from "@/client/input/ChunkCursor.js";
import {CenterMarkerLayer} from "@/client/layers/CenterMarkerLayer.js";
import {MapButtonsLayer} from "@/client/hud/MapButtonsLayer.js";
import {drawClaimIcon, drawHomeIcon} from "@/client/hud/icons.js";
import {advanceAnimationFrame} from "@/client/layers/animation.js";
import {DEV, BROWSER} from "@/common/env.js";
import {ListenerList} from "@/common/ListenerList.js";
import {
    SESSION_STATUS_CONNECTED, SESSION_STATUS_RECONNECTING, SESSION_STATUS_SERVER_SHUTDOWN, SESSION_STATUS_SUPERSEDED,
    SESSION_STATUS_REJECTED,
} from "@/client/RemoteSession.js";

// Frame time spent applying queued sync events; about a sixth of a 60fps frame.
const DRAIN_BUDGET_MS = 2.5;

// Handed to the layer tick in overworld mode, where no chunks are mounted: building the real
// visible-chunk set at overworld scale would enumerate thousands of chunks per frame.
const NO_VISIBLE_CHUNKS = new Set();

// Leading entries shown per column when logging a columnar batch event.
const LOG_BATCH_ITEMS = 5;

// Settings-menu placement of the "Display" section.
const DISPLAY_CATEGORY_ORDER = 0;

// Terrain rendering while the device setting is unset.
const TERRAIN_ENABLED_DEFAULT = false;

/**
 * A console view of an event: a batch event's columns cut to their first {@link LOG_BATCH_ITEMS}
 * entries, a sync bundle's inner events mapped the same way; other events log as-is.
 * @param {AbstractEvent} event
 * @returns {object}
 */
function eventLogView(event) {
    if (event instanceof ChunkSyncEvent) {
        return {event: event.constructor.name, chunk: event.chunk, events: event.events.map(eventLogView)};
    }
    if (!(event instanceof AbstractBatchEvent)) {
        return event;
    }
    const view = {event: event.constructor.name};
    for (const [field, type] of Object.entries(event.constructor.wireFields)) {
        const value = event[field];
        if (type.endsWith("[]") && value.length > LOG_BATCH_ITEMS) {
            view[field] = `[${value.slice(0, LOG_BATCH_ITEMS).join(", ")}, … ${value.length} total]`;
        } else {
            view[field] = value;
        }
    }
    return view;
}

export class Client {

    /**
     * @param {Application} app
     * @param {ClientViewport} viewport
     * @param {AbstractSession} session
     * @param {ModRegistry} modRegistry
     */
    constructor(app, viewport, session, modRegistry) {
        this.app = app;
        this.viewport = viewport;
        this.session = session;
        this.modRegistry = modRegistry;

        this.textureRegistry = new TextureRegistry();
        // Artist edits from the sprite editor, painted over the atlases once they load.
        this.spriteOverrideStore = new SpriteOverrideStore();
        this.drawLayerRegistry = new DrawLayerRegistry();
        this._buildStateCache();
        this._buildTerrain();
        this._buildToolHud();
        this._buildSharedWorldLayers();
        this._buildStatusHud();
        this._buildTopBarHud();
        this._buildOverlayHud();
        this._buildChunkLayers();
        this._buildModSurface();
        this._collectThemedLayers();
        this._registerWorldLayers();
        this._initStreamingState();
        this._buildInputModes();
    }

    /**
     * Registers every state namespace on the shared cache.
     * @private
     * @returns {void}
     */
    _buildStateCache() {
        // The shared plain-data state tree: every namespace registers schema + writer + view,
        // every event fans out to every writer, and readers subscribe by path or query the views.
        // The objects writer registers first so object state lands before any reader; mods
        // register their namespaces in setup. The objects view doubles as the shared cross-mod
        // spatial index (`client.objects`), queried by tools/layers for tile lookups, placement
        // collision, and connection rendering.
        this.cache = new ClientCache();
        this.objects = new ObjectsView(this.modRegistry);
        this.cache.register("objects", OBJECTS_SCHEMA, new ObjectsWriter(this.modRegistry, this.cache), this.objects);
        this.cache.register("chunkClaims", CHUNK_CLAIMS_SCHEMA, new ChunkClaimsWriter(this.cache), new ChunkClaimsView());
        this.cache.register("players", PLAYERS_SCHEMA, new PlayersWriter(this.cache), new PlayersView());
        this.cache.register("gameSettings", GAME_SETTINGS_SCHEMA, new GameSettingsWriter(this.cache), new GameSettingsView());
        this.cache.register("playerSettings", PLAYER_SETTINGS_SCHEMA, new PlayerSettingsWriter(this.cache), new PlayerSettingsView());
        this.cache.register("workerAssignments", WORKER_ASSIGNMENTS_SCHEMA, new WorkerAssignmentsWriter(this.cache), new WorkerAssignmentsView());
        this.cache.register("overworld", OVERWORLD_SCHEMA, new OverworldWriter(this.cache), new OverworldView());
        this.cache.register("inspect", INSPECT_SCHEMA, new InspectWriter(this.cache), new InspectView());
        this.cache.register("metrics", METRICS_SCHEMA, new MetricsWriter(this.cache), new MetricsView());
        this.cache.register("clock", CLOCK_SCHEMA, new ClockWriter(this.cache), new ClockView());
        // The open-menu set rides to the sim as the inspect subscription, whoever changes it.
        this.cache.subscribe("inspect.openObjects", () => this._sendInspectedObjects());
    }

    /**
     * Builds the terrain twin and its ground layers, repainted once the seed syncs.
     * @private
     * @returns {void}
     */
    _buildTerrain() {
        /**
         * Seeded terrain noise, the sim's twin; null until the game settings sync arrives.
         * @type {WorldNoise|null}
         */
        this.noise = null;

        /**
         * Tile -> biome over the noise, the sim's twin; null until the seed arrives.
         * @type {Terrain|null}
         */
        this.terrain = null;
        // The ground, repainted from the terrain once the seed arrives.
        this.terrainLayer = new TerrainDrawLayer(this.modRegistry.biomes);
        this.terrainDetailLayer = new TerrainDetailLayer(this.modRegistry.biomes);
        this.setTerrainEnabled(DeviceSettings.getBoolean(DEVICE_SETTING_TERRAIN, TERRAIN_ENABLED_DEFAULT));
        this.cache.subscribe("gameSettings.values", (key, value) => {
            if (key === GameSettingsKey.SEED) {
                this.noise = new WorldNoise(value, this.modRegistry.noiseChannels);
                this.terrain = new Terrain(this.noise, this.modRegistry.biomes);
                this.terrainLayer.setTerrain(this.terrain);
                this.terrainDetailLayer.setTerrain(this.terrain);
            }
        });
    }

    /**
     * Builds the tool-facing HUD and the shared placement state tools read.
     * @private
     * @returns {void}
     */
    _buildToolHud() {
        // Screen-space panels for open machine menus; fed by the inspect heartbeat state.
        this.inspectPanelLayer = new InspectPanelLayer(this.app, this.cache);
        // Rotate controls, toggled with the active tool by the host.
        this.rotateButtonsLayer = new RotateButtonsLayer(this.app, this.viewport);
        // Bottom-center tool bar; the host feeds it the tool list and reacts to selection.
        this.toolbarLayer = new ToolbarLayer(this.app, this.viewport);
        this.toolbarLayer.onReorder(tools => this.setModToolOrder(tools));
        // Shared placement-feedback layer, driven by whichever tool is active.
        this.placementFeedbackLayer = new PlacementFeedbackLayer();
        // Built once: coreTools() must return the same instances every call so a toolbar rebuild
        // (reorder, resync) doesn't orphan an active core tool's identity.
        this._coreTools = [new EraserTool(this)];
        // Shared placement facing, so orientation persists across tool switches.
        this.toolRotation = new ToolRotation();
    }

    /**
     * Builds the world layers shared across mods (items, inspect, connections, workers).
     * @private
     * @returns {void}
     */
    _buildSharedWorldLayers() {
        // The single shared item layer: belts drive their computed-position items imperatively;
        // resting out-port items render here automatically from the port-item events.
        this.itemLayer = new ItemDrawLayer(this.modRegistry.items);
        // Shared hover-highlight layer, driven by mods' inspect hover.
        this.inspectLayer = new InspectLayer();
        // The hovered item's bracket, drawn between the items and the objects carrying them.
        this.itemInspectLayer = new ItemInspectLayer(this.itemLayer, this.inspectLayer);
        // The bracketed item's name, docked above its bracket.
        this.inspectTooltipLayer = new InspectTooltipLayer(this.app, this.itemInspectLayer, this.modRegistry.items);
        // The single shared connection-stub layer, derived from the cache as objects change.
        this.connectionLayer = new ConnectionDrawLayer();
        // Commuting worker figures for manned machines, routed over the cached road tiles.
        this.workerLayer = new WorkerDrawLayer(this.cache);
        // Debug overlay: road components, attachments, and assignments; hidden outside debug mode.
        this.workerDebugLayer = new WorkerDebugLayer(this.cache);
        // Staffing dots over manned machines (one per consumed worker).
        this.workerBadgeLayer = new WorkerBadgeLayer(this.cache);
    }

    /**
     * Builds the top-left status message and counter stack.
     * @private
     * @returns {void}
     */
    _buildStatusHud() {
        // Top-left connection/chunk-loading status overlay. A static screen-space HUD on
        // app.stage (sibling of the viewport), so it never pans or zooms with the world.
        this.statusLayer = new StatusMessageLayer(this.app);
        this.statusLayer.setConnecting();
        // The top bar's height, so the counter list knows whether the bar owns the top-left corner.
        this._topBarHeight = 0;
        // The status message's height, so the counter list stacks under it rather than behind it.
        this._statusHeight = 0;
        // The hovered counter's label and exact amount.
        this.counterTooltip = new CounterTooltip(this.app);
        // Top-left running counts (currency balance, and whatever else contributes a counter),
        // stacked under the status message and hidden while the top bar owns the edge.
        this.counterListLayer = new CounterListLayer(this.app, this.counterTooltip);
        this.statusLayer.onChange((height) => {
            this._statusHeight = height;
            this._layoutTopLeft();
        });
    }

    /**
     * Builds the top bar, its corner buttons, and the panels they open.
     * @private
     * @returns {void}
     */
    _buildTopBarHud() {
        // Full-width top status bar: core systems and mods each own a section by id (text +
        // buttons), e.g. claim mode's claim count and exit button.
        this.topStatusBar = new TopStatusBarLayer(this.app);
        // Full-width bottom bar holding the active mode's forward action (its text + Confirm).
        this.bottomActionBar = new BottomActionBarLayer(this.app);
        // Always-visible top-right settings button; stays clear of the bar above via its height.
        this.settingsButtonLayer = new SettingsButtonLayer(this.app);
        // Friend management (account-wide, not gated behind claim mode); sits left of settings.
        this.friendsButtonLayer = new FriendsButtonLayer(this.app);
        this.friendsPanelLayer = new FriendsPanelLayer(this.app, this.cache);
        this.friendsButtonLayer.onPress(() => this.friendsPanelLayer.toggle());
        // Opens the production metrics panel; sits left of friends.
        this.productionButtonLayer = new ProductionButtonLayer(this.app);
        this.productionPanelLayer = new ProductionPanelLayer(
            this.app,
            this.cache,
            METRICS_FACT_TYPE_ITEM_PRODUCED,
            METRICS_QUERY_SCOPE_OWN,
            this.modRegistry.items,
        );
        this.productionButtonLayer.onPress(() => this.productionPanelLayer.toggle());
        // Opens the sprite editor (Game.vue owns it); sits left of production.
        this.artButtonLayer = new ArtButtonLayer(this.app);
        // Opens the terrain tuner (Game.vue owns it); sits left of art.
        this.terrainButtonLayer = new TerrainButtonLayer(this.app);
        this.productionPanelLayer.onSubscribe((metricsType, scope, tier, windowTicks) => this.sendMessage(
            new MetricsSubscribeMessage(metricsType, scope, tier, windowTicks),
        ));
        this.productionPanelLayer.onUnsubscribe((metricsType, scope) => this.sendMessage(
            new MetricsUnsubscribeMessage(metricsType, scope),
        ));
        this.friendsPanelLayer.onAddByCode(
            code => this.sendMessage(new AddFriendByCodeMessage(code)),
        );
        this.friendsPanelLayer.onAddFriend(playerId => this.sendMessage(new AddFriendMessage(playerId)));
        this.friendsPanelLayer.onUnfriend(playerId => this.sendMessage(new RemoveFriendMessage(playerId)));
        this.friendsPanelLayer.onError(message => this.notify(message));
        this.topStatusBar.onChange((height) => {
            // The bar's height already covers the safe area; the inset only matters while it is hidden.
            const offset = Math.max(height, SafeArea.insets().top);
            this.settingsButtonLayer.setTopOffset(offset);
            this.friendsButtonLayer.setTopOffset(offset);
            this.productionButtonLayer.setTopOffset(offset);
            this.artButtonLayer.setTopOffset(offset);
            this.terrainButtonLayer.setTopOffset(offset);
            this.statusLayer.setTopOffset(offset);
            this._topBarHeight = height;
            this._layoutTopLeft();
        });
    }

    /**
     * Builds the watermark, toast, dialog, center marker, and map buttons.
     * @private
     * @returns {void}
     */
    _buildOverlayHud() {
        // Bottom-left build watermark (desktop only).
        this.versionWatermarkLayer = new VersionWatermarkLayer(this.app);
        // Bottom-center toast (claim rejections, session disconnects).
        this.noticeLayer = new NoticeLayer(this.app);
        // Centered confirm/cancel dialog, currently only the destructive unclaim confirm.
        this.confirmDialogLayer = new ConfirmDialogLayer(this.app);
        // Center-lock aim point for claim selection (mobile).
        this.centerMarkerLayer = new CenterMarkerLayer(this.app, this.viewport);
        // Contextual map-mode buttons (bottom-right): chunk administration entry and home.
        this.mapButtonsLayer = new MapButtonsLayer(this.app);
        this.mapButtonsLayer.addButton("claimSelection", drawClaimIcon, () => this.claimSelection.toggle());
        this.mapButtonsLayer.addButton("home", drawHomeIcon, () => this.glideHome());
    }

    /**
     * Builds the chunk claim/selection layers and the selected chunk's action stack.
     * @private
     * @returns {void}
     */
    _buildChunkLayers() {
        // Ownership borders for claimed chunks (map/overworld mode).
        this.chunkClaimsLayer = new ChunkClaimsDrawLayer(this.cache);
        this.drawLayerRegistry.add(this.chunkClaimsLayer);
        // Selected-chunk and hovered-chunk squares (map/overworld mode).
        this.chunkSelectionLayer = new ChunkSelectionLayer(this.cache.view("chunkClaims"));
        this.drawLayerRegistry.add(this.chunkSelectionLayer);
        // Dashed claim-frontier squares while claim selection mode is on.
        this.claimFrontierLayer = new ClaimFrontierDrawLayer(this.cache);
        this.drawLayerRegistry.add(this.claimFrontierLayer);
        // The selected chunk's action stack, anchored beside the chunk (map mode).
        this.chunkActionsLayer = new ChunkActionsLayer(this.app, this.viewport, this.cache.view("chunkClaims"), this.cache.view("players"));
        this.chunkActionsLayer.onClaim(chunk => this.sendMessage(new ClaimChunkMessage(chunk)));
        this.chunkActionsLayer.onUnclaim(chunk => this.sendMessage(new UnclaimChunkMessage(chunk)));
        this.chunkActionsLayer.onAddFriend(playerId => this.sendMessage(new AddFriendMessage(playerId)));
        this.chunkActionsLayer.onUnfriend(playerId => this.sendMessage(new RemoveFriendMessage(playerId)));
        this.chunkActionsLayer.onSetPermission(
            (chunk, permission) => this.sendMessage(new SetChunkPermissionMessage(chunk, permission)),
        );
    }

    /**
     * Builds the per-type client bundles, then lets every client mod set itself up.
     * @private
     * @returns {void}
     */
    _buildModSurface() {
        // The derived client surface (draw layer + ghost + tool) of every behavior-driven type;
        // bespokeClient types (belts) bring their own through their client mod.
        this.bundles = this._buildBundles();
        for (const bundle of this.bundles) {
            this.drawLayerRegistry.add(bundle.drawLayer);
            this.drawLayerRegistry.add(bundle.ghostLayer);
        }
        for (const mod of this.modRegistry.clientMods) {
            mod.setup(this);
        }
        // Built once, same as _coreTools: a toolbar rebuild (reorder, resync) must never orphan a
        // bespoke mod tool's identity by reallocating it.
        this._bespokeModTools = this.modRegistry.clientMods.flatMap(mod => mod.tools(this));
        for (const layer of this.modRegistry.clientMods.flatMap(mod => mod.drawLayers(this))) {
            this.drawLayerRegistry.add(layer);
        }
        // Screen-space HUD layers (unlike drawLayers, mounted straight onto app.stage in init()).
        this._modHudLayers = this.modRegistry.clientMods.flatMap(mod => mod.hudLayers(this));
    }

    /**
     * Collects the HUD layers that repaint on a theme change.
     * @private
     * @returns {void}
     */
    _collectThemedLayers() {
        // Layers holding themed pixels; world layers draw from the non-themed placement palette.
        // A mod HUD layer opts in by defining restyle.
        this._themedLayers = [
            this.inspectPanelLayer,
            this.rotateButtonsLayer,
            this.toolbarLayer,
            this.statusLayer,
            this.counterListLayer,
            this.topStatusBar,
            this.bottomActionBar,
            this.settingsButtonLayer,
            this.friendsButtonLayer,
            this.friendsPanelLayer,
            this.productionButtonLayer,
            this.productionPanelLayer,
            this.artButtonLayer,
            this.terrainButtonLayer,
            this.noticeLayer,
            this.confirmDialogLayer,
            this.mapButtonsLayer,
            this.chunkActionsLayer,
            this.inspectTooltipLayer,
            this.counterTooltip,
            ...this._modHudLayers.filter(layer => layer.restyle !== undefined),
        ];
        onThemeChange(() => this._restyleHud());
    }

    /**
     * Registers the remaining world layers, then binds every layer to the cache.
     * @private
     * @returns {void}
     */
    _registerWorldLayers() {
        // The overworld renderer, active below the overworld zoom threshold.
        this.overworldLayer = new OverworldDrawLayer(this.modRegistry, this.cache);
        this.drawLayerRegistry.add(this.overworldLayer);
        this.drawLayerRegistry.add(this.terrainLayer);
        this.drawLayerRegistry.add(this.terrainDetailLayer);
        this.drawLayerRegistry.add(new GridDrawLayer());
        this.drawLayerRegistry.add(this.placementFeedbackLayer);
        this.drawLayerRegistry.add(this.inspectLayer);
        this.drawLayerRegistry.add(this.itemInspectLayer);
        this.drawLayerRegistry.add(this.itemLayer);
        this.drawLayerRegistry.add(this.connectionLayer);
        this.drawLayerRegistry.add(this.workerLayer);
        this.drawLayerRegistry.add(this.workerDebugLayer);
        this.drawLayerRegistry.add(this.workerBadgeLayer);

        // One bind per layer: sets the shared cache and registers whichever cache hooks the layer
        // overrides — before init, since cache writes can arrive while textures load.
        for (const layer of this.drawLayerRegistry.layers) {
            layer.bindCache(this.objects);
        }
    }

    /**
     * Initializes chunk subscription, the event queue, and view-mode state.
     * @private
     * @returns {void}
     */
    _initStreamingState() {
        // Chunks currently subscribed on the server: the visible chunks.
        this._requestedChunks = new Set();
        // Per-delta events awaiting the budgeted per-frame drain: a chunk-sync bundle explodes to
        // hundreds of cache writes + sprite builds. Later events queue only when their own chunk
        // still has queued sync (per-chunk order); everything else applies on arrival, so live
        // tick traffic for already-synced chunks can never pile up behind a loading burst.
        this._pendingEvents = [];
        // chunk -> its queued event count; a chunk with an entry gates its later events.
        this._queuedCountByChunk = new Map();
        this._lastVisibleKey = null;
        // Rebuilds the visible-chunk set only when the covered rect moves.
        this._chunkWindow = new ViewportChunkWindow();
        this._viewMode = ViewMode.WORLD;
        this._onViewModeChange = null;
        this._lastOverworldRefreshMs = 0;
        this._lastFriendsPanelRefreshMs = 0;
        this._centerLock = false;
        this._debugMode = false;
        // Host event listeners, the last stop of the event fan-out.
        this._eventListeners = new ListenerList();
    }

    /**
     * Builds the chunk-picking input modes and the claim feedback that listens with them.
     * @private
     * @returns {void}
     */
    _buildInputModes() {
        // The selected chunk, shared by the chunk-picking modes below.
        this.chunkCursor = new ChunkCursor(this);
        // Chunk administration input mode controller.
        this.claimSelection = new ClaimSelectionMode(this);
        this.onEvent(event => this.claimSelection.onEvent(event));
        // The first-claim flow, owning the state before the player holds any chunk.
        this.settleFlow = new SettleFlow(this);
        this.onEvent(event => this.settleFlow.onEvent(event));
        // Toast/confirm-dialog feedback for claim/unclaim rejections.
        this.claimResultFeedback = new ClaimResultFeedback(this);
        this.onEvent(event => this.claimResultFeedback.onEvent(event));
        this.onEvent(event => this.friendsPanelLayer.onEvent(event));
    }

    /**
     * Shows the toolbar only in world view with at least one claimed chunk: placement tools are
     * inert while zoomed to map/overworld (EffectiveToolController nulls the effective tool
     * there), and irrelevant with nothing to build on.
     * @returns {void}
     */
    refreshToolbarVisibility() {
        const hasClaims = this.cache.view("chunkClaims").hasOwnClaims();
        this.toolbarLayer.visible = hasClaims && this._viewMode === ViewMode.WORLD;
    }

    /**
     * Shows a toast notice (claim rejections, session disconnects).
     * @param {string} text
     * @returns {void}
     */
    notify(text) {
        this.noticeLayer.notify(text);
    }

    /**
     * Reacts to the remote session's connection status; local sessions never call this. Shows a
     * persistent status message while down, clears it and resyncs once reconnected.
     * @param {string} status
     * @returns {void}
     */
    onConnectionStatusChange(status) {
        if (status === SESSION_STATUS_RECONNECTING) {
            this.statusLayer.setOverride("Reconnecting…");
        } else if (status === SESSION_STATUS_SERVER_SHUTDOWN) {
            this.statusLayer.setOverride("Server is restarting…");
        } else if (status === SESSION_STATUS_SUPERSEDED) {
            this.statusLayer.setOverride("Signed in on another device");
        } else if (status === SESSION_STATUS_REJECTED) {
            this.statusLayer.setOverride("Could not reconnect. Refresh the page");
        } else if (status === SESSION_STATUS_CONNECTED) {
            this.statusLayer.clearOverride();
            this._resync();
        }
    }

    /**
     * Wipes the stale cache and re-requests the current viewport/overworld data after a
     * reconnect: the server has no memory of this connection's old subscriptions.
     * @private
     * @returns {void}
     */
    _resync() {
        this.cache.reset();
        this.statusLayer.reset();
        this._lastVisibleKey = null;
        if (this._viewMode === ViewMode.OVERWORLD) {
            this._lastOverworldRefreshMs = 0;
            this._refreshOverworld(true);
        } else {
            this._requestedChunks.clear();
            this._updateViewportChunks();
        }
        this.notify("Reconnected");
    }

    /**
     * @returns {ViewMode}
     */
    get viewMode() {
        return this._viewMode;
    }

    /**
     * Mirrors the sim's placement gate for the chunk under a tile; tools route their
     * ghost/placement checks through here.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {boolean}
     */
    canBuildAt(tileX, tileY) {
        return this.cache.view("chunkClaims").canBuildIn(chunkId(tileX, tileY));
    }

    /**
     * Whether every client mod's canPlace allows the placement.
     * @param {ObjectType} type
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @returns {boolean}
     */
    modsAllowPlacement(type, tileX, tileY, direction) {
        return this.modRegistry.clientMods.every(mod => mod.canPlace(type, tileX, tileY, direction, this));
    }

    /**
     * The world-pixel centroid of the player's claimed chunks, or null with none.
     * @returns {{x: number, y: number}|null}
     */
    ownClaimsCenter() {
        const chunks = this.cache.view("chunkClaims").ownChunks();
        if (chunks.length === 0) {
            return null;
        }
        let sumX = 0;
        let sumY = 0;
        for (const chunk of chunks) {
            const center = chunkCenter(chunk);
            sumX += center.x * TILE_SIZE;
            sumY += center.y * TILE_SIZE;
        }
        return {x: sumX / chunks.length, y: sumY / chunks.length};
    }

    /**
     * Glides the viewport to the claims centroid at the current zoom; a no-op with no claims.
     * @returns {void}
     */
    glideHome() {
        const center = this.ownClaimsCenter();
        if (center === null) {
            return;
        }
        this.viewport.glideTo({x: center.x, y: center.y});
    }

    /**
     * Snaps the viewport to the claims centroid with no glide; a no-op with no claims.
     * @returns {void}
     */
    startAtHome() {
        const center = this.ownClaimsCenter();
        if (center === null) {
            return;
        }
        this.viewport.moveCenter(center.x, center.y);
        // moveCenter emits no "moved"; refresh the data feed directly.
        this._onViewportMoved();
    }

    /**
     * Opens a machine's menu: subscribes to its per-tick inspect snapshots.
     * @param {number} objectId
     * @returns {void}
     */
    inspectObject(objectId) {
        this.cache.writer("inspect").open(objectId);
    }

    /**
     * Closes a machine's menu: drops its subscription and its panel.
     * @param {number} objectId
     * @returns {void}
     */
    unInspectObject(objectId) {
        this.cache.writer("inspect").close(objectId);
    }

    _sendInspectedObjects() {
        this.sendMessage(new SetInspectedObjectsMessage(this.cache.view("inspect").openIds()));
    }

    /**
     * @returns {AbstractTool[]}
     */
    coreTools() {
        return this._coreTools;
    }

    /**
     * Toggles debug mode, showing or hiding debug-only draw layers.
     * @returns {void}
     */
    toggleDebugMode() {
        this._debugMode = !this._debugMode;
        this.drawLayerRegistry.setDebugMode(this._debugMode);
        this.inspectPanelLayer.setDebug(this._debugMode);
        this.toolbarLayer.setDebug(this._debugMode);
        this.counterListLayer.setDebug(this._debugMode);
    }

    /**
     * Registers the handler invoked when the zoom-driven view mode changes.
     * @param {function(mode: ViewMode)} callback
     */
    onViewModeChange(callback) {
        this._onViewModeChange = callback;
    }

    /**
     * @returns {Promise<void>}
     */
    async init() {
        await this.textureRegistry.load(this.modRegistry.textureAtlases);
        // Storage can be off (private mode, policy); art edits are optional, the game is not.
        try {
            await this.spriteOverrideStore.applyTo(this.textureRegistry);
        } catch (error) {
            console.warn(`Sprite overrides unavailable: ${error.message}`);
        }

        for (const layer of this.drawLayerRegistry.layers) {
            layer.textureRegistry = this.textureRegistry;
            layer.viewport = this.viewport;
            this.viewport.addChild(layer);
        }

        this.toolbarLayer.textureRegistry = this.textureRegistry;
        this.inspectPanelLayer.textureRegistry = this.textureRegistry;
        this.inspectPanelLayer.items = this.modRegistry.items;
        this.inspectPanelLayer.viewport = this.viewport;
        this.inspectPanelLayer.onClose(objectId => this.unInspectObject(objectId));
        this.statusLayer.textureRegistry = this.textureRegistry;
        this.statusLayer.refreshBackground();
        this._layoutTopLeft();
        this.topStatusBar.textureRegistry = this.textureRegistry;
        this.topStatusBar.refreshBackground();
        this.bottomActionBar.textureRegistry = this.textureRegistry;
        this.bottomActionBar.refreshBackground();
        this.noticeLayer.textureRegistry = this.textureRegistry;
        this.confirmDialogLayer.textureRegistry = this.textureRegistry;
        this.chunkActionsLayer.textureRegistry = this.textureRegistry;
        // A chunk can be selected before the textures land, which skips the stack's build.
        this.chunkActionsLayer.refresh();
        this.friendsPanelLayer.textureRegistry = this.textureRegistry;
        this.friendsPanelLayer.viewport = this.viewport;
        this.friendsPanelLayer.anchorButton = this.friendsButtonLayer;
        this.productionPanelLayer.textureRegistry = this.textureRegistry;
        this.productionPanelLayer.anchorButton = this.productionButtonLayer;
        this.productionPanelLayer.viewport = this.viewport;
        this.app.stage.addChild(this.versionWatermarkLayer);
        this.app.stage.addChild(this.centerMarkerLayer);
        this.app.stage.addChild(this.mapButtonsLayer);
        this.app.stage.addChild(this.chunkActionsLayer);
        this.app.stage.addChild(this.rotateButtonsLayer);
        this.app.stage.addChild(this.toolbarLayer);
        this.app.stage.addChild(this.statusLayer);
        this.app.stage.addChild(this.counterListLayer);
        this.app.stage.addChild(this.counterTooltip);
        this.app.stage.addChild(this.topStatusBar);
        this.app.stage.addChild(this.bottomActionBar);
        this.inspectTooltipLayer.viewport = this.viewport;
        this.app.stage.addChild(this.inspectTooltipLayer);
        this.app.stage.addChild(this.settingsButtonLayer);
        this.app.stage.addChild(this.friendsButtonLayer);
        this.app.stage.addChild(this.productionButtonLayer);
        this.app.stage.addChild(this.artButtonLayer);
        this.app.stage.addChild(this.terrainButtonLayer);
        // Panels sit above every other HUD layer.
        this.app.stage.addChild(this.inspectPanelLayer);
        this.app.stage.addChild(this.friendsPanelLayer);
        this.app.stage.addChild(this.productionPanelLayer);
        for (const layer of this._modHudLayers) {
            layer.textureRegistry = this.textureRegistry;
            layer.viewport = this.viewport;
            this.app.stage.addChild(layer);
        }
        // Toast and confirm dialog sit above every other HUD layer, including panels.
        this.app.stage.addChild(this.noticeLayer);
        this.app.stage.addChild(this.confirmDialogLayer);

        this.viewport.on("moved", () => this._onViewportMoved());
        // "zoomed" fires mid-wheel with the over-zoomed scale, before clampZoom restores it;
        // reading the viewport here would briefly see an expanded area and subscribe chunks
        // that aren't really on screen. The chunk update rides "moved", which fires after the
        // clamp with the settled scale, so only the view mode (thresholds well inside the zoom
        // limits, never mid-clamp) keys off "zoomed".
        this.viewport.on("zoomed", () => this._updateViewMode());
        // Scale-only glides emit "zoomed" but never "moved"; the settled zoom (post-clamp)
        // catches the data feed up here.
        this.viewport.on("zoomed-end", () => this._onViewportMoved());
        // While a pan is in progress, drop the rotate buttons out of hit-testing so
        // a finger that crosses one keeps panning instead of being captured by it.
        this.viewport.on("drag-start", () => this.rotateButtonsLayer.setInteractive(false));
        this.viewport.on("drag-end", () => this.rotateButtonsLayer.setInteractive(true));
        this.app.ticker.add(() => this._tickAnimations());
        this._updateViewportChunks();
        this._updateViewMode();
        for (const mod of this.modRegistry.clientMods) {
            mod.onReady(this);
        }
    }

    /**
     * Drives sprite animation off the render loop, passing the frame's elapsed time.
     * @private
     */
    _tickAnimations() {
        const deltaMS = this.app.ticker.deltaMS;
        this._drainPendingEvents();
        // Derived once here rather than per layer: every chunk-culled layer needs the same set, and
        // rebuilding it per layer costs a chunkId per visible chunk each.
        let visibleChunks;
        if (this._viewMode === ViewMode.OVERWORLD) {
            visibleChunks = NO_VISIBLE_CHUNKS;
        } else {
            visibleChunks = this._chunkWindow.chunks(this.viewport);
        }
        this.drawLayerRegistry.tick(
            advanceAnimationFrame(deltaMS),
            deltaMS,
            visibleChunks,
        );
    }

    /**
     * Routes viewport movement to the mode's data feed: chunk subscriptions, or overworld
     * snapshot refreshes when zoomed past the map band.
     * @private
     */
    _onViewportMoved() {
        if (this._viewMode === ViewMode.OVERWORLD) {
            this._refreshOverworld(false);
        } else {
            this._updateViewportChunks();
        }
        // The nearby-in-view roster reads the current viewport directly; the claims mirror it
        // draws from may already hold every chunk in the new view, so no cache event would
        // otherwise tell it to recompute. Throttled like _refreshOverworld: "moved" fires on
        // every step of a drag, and a rebuild here tears down and recreates the add-by-name
        // field's real DOM input, not just some pixi Graphics.
        const now = Date.now();
        if (now - this._lastFriendsPanelRefreshMs >= FRIENDS_PANEL_REFRESH_THROTTLE_MS) {
            this._lastFriendsPanelRefreshMs = now;
            this.friendsPanelLayer.refresh();
        }
    }

    /**
     * Switches the view mode when the viewport scale crosses {@link MAP_MODE_SCALE_THRESHOLD}
     * or {@link OVERWORLD_SCALE_THRESHOLD}, transitioning the data feeds with it.
     * @private
     */
    _updateViewMode() {
        const scale = this.viewport.scale.x;
        let mode;
        if (scale < OVERWORLD_SCALE_THRESHOLD) {
            mode = ViewMode.OVERWORLD;
        } else if (scale < MAP_MODE_SCALE_THRESHOLD) {
            mode = ViewMode.MAP;
        } else {
            mode = ViewMode.WORLD;
        }
        if (mode === this._viewMode) {
            return;
        }
        const previous = this._viewMode;
        this._viewMode = mode;
        this.drawLayerRegistry.setViewMode(mode);
        this.mapButtonsLayer.setViewMode(mode);
        this.friendsPanelLayer.setViewMode(mode);
        this.refreshToolbarVisibility();
        for (const mod of this.modRegistry.clientMods) {
            mod.setViewMode(mode, this);
        }
        if (this._onViewModeChange != null) {
            this._onViewModeChange(mode);
        }
        this.claimSelection.onViewMode(previous);
        this.settleFlow.onViewMode(previous);
        if (mode === ViewMode.OVERWORLD) {
            this._enterOverworld();
        } else if (previous === ViewMode.OVERWORLD) {
            this._leaveOverworld();
        }
    }

    /**
     * Drops every chunk subscription at once (the teardown is invisible behind the overworld
     * layer) and requests the first snapshot.
     * @private
     */
    _enterOverworld() {
        this._requestedChunks.clear();
        this._sendViewport(false);
        this._lastVisibleKey = null;
        this._refreshOverworld(true);
    }

    /**
     * Resubscribes the visible chunks through the normal viewport path.
     * @private
     */
    _leaveOverworld() {
        this._lastVisibleKey = null;
        this._updateViewportChunks();
    }

    /**
     * Requests the visible overworld rect when any of its chunks is missing or stale, then
     * evicts stale entries outside it. Throttled while panning; `force` bypasses.
     * @private
     * @param {boolean} force
     */
    _refreshOverworld(force) {
        const now = Date.now();
        if (!force && now - this._lastOverworldRefreshMs < OVERWORLD_REFRESH_THROTTLE_MS) {
            return;
        }
        this._lastOverworldRefreshMs = now;
        const rect = this._visibleOverworldRect();
        if (rect === null) {
            return;
        }
        if (this.cache.view("overworld").needsFetch(rect, now, OVERWORLD_CHUNK_TTL_MS)) {
            this.sendMessage(new OverworldRequestMessage(rect.chunkX, rect.chunkY, rect.chunkWidth, rect.chunkHeight));
        }
        this.cache.writer("overworld").evictOutside(rect, now, OVERWORLD_CHUNK_TTL_MS);
    }

    /**
     * The viewport's chunk rect clamped to the region, or null when fully outside it.
     * @private
     * @returns {OverworldRect|null}
     */
    _visibleOverworldRect() {
        const chunkPx = CHUNK_SIZE * TILE_SIZE;
        const left = Math.max(Math.floor(this.viewport.left / chunkPx), -REGION_HALF);
        const top = Math.max(Math.floor(this.viewport.top / chunkPx), -REGION_HALF);
        const right = Math.min(Math.floor(this.viewport.right / chunkPx), REGION_HALF - 1);
        const bottom = Math.min(Math.floor(this.viewport.bottom / chunkPx), REGION_HALF - 1);
        if (right < left || bottom < top) {
            return null;
        }
        return new OverworldRect(left, top, right - left + 1, bottom - top + 1);
    }

    /**
     * @private
     * @param {number} [marginChunks] - extra chunk rings beyond the viewport
     */
    _visibleChunks(marginChunks = 0) {
        const margin = marginChunks * CHUNK_SIZE;
        const x1 = this.viewport.left / TILE_SIZE - margin;
        const y1 = this.viewport.top / TILE_SIZE - margin;
        const x2 = this.viewport.right / TILE_SIZE + margin;
        const y2 = this.viewport.bottom / TILE_SIZE + margin;

        const chunks = [];
        for (let x = snapToChunk(x1) - CHUNK_SIZE; x <= snapToChunk(x2); x += CHUNK_SIZE) {
            for (let y = snapToChunk(y1) - CHUNK_SIZE; y <= snapToChunk(y2); y += CHUNK_SIZE) {
                chunks.push(chunkId(x, y));
            }
        }
        return chunks;
    }

    /**
     * @private
     */
    _updateViewportChunks() {
        if (this._viewMode === ViewMode.OVERWORLD) {
            // No chunk subscriptions in overworld; enumerating the visible chunks at overworld
            // scale would also walk thousands of ids.
            return;
        }
        const visible = this._visibleChunks();
        const visibleKey = visible.slice().sort().join(";");
        if (visibleKey === this._lastVisibleKey) {
            return;
        }
        this._lastVisibleKey = visibleKey;

        // Unsubscribe only past a one-chunk hysteresis ring, so a pan grazing a boundary
        // never re-syncs the chunk.
        let changed = false;
        const retained = new Set(this._visibleChunks(1));
        for (const chunk of [...this._requestedChunks]) {
            if (!retained.has(chunk)) {
                this._requestedChunks.delete(chunk);
                changed = true;
            }
        }
        let added = false;
        for (const chunk of visible) {
            if (!this._requestedChunks.has(chunk)) {
                this._requestedChunks.add(chunk);
                added = true;
                changed = true;
            }
        }
        if (changed) {
            this._sendViewport(added);
        }
    }

    /**
     * Sends the current requested-chunk set to the server.
     * @private
     * @param {boolean} loading - whether to drive the loading status (only when subscribing)
     */
    _sendViewport(loading) {
        const chunks = [...this._requestedChunks];
        if (loading) {
            // Track the request before sending: single-player replies with the
            // ChunkSubscribeEvents synchronously, so the layer must already be counting.
            this.statusLayer.beginChunkLoad(chunks);
        }
        this.sendMessage(new SetViewportMessage(chunks));
    }

    /**
     * @returns {boolean} whether center-lock (mobile mode) is active
     */
    get centerLock() {
        return this._centerLock;
    }

    /**
     * Toggles center-lock (mobile mode): pins hover/placement and the preview to the screen center.
     * @param {boolean} enabled
     */
    setCenterLock(enabled) {
        if (enabled === this._centerLock) {
            return;
        }
        this._centerLock = enabled;
        // Draw layers before the input layer, so a hover Mouse emits renders with center-lock on.
        this.drawLayerRegistry.setCenterLock(enabled);
        Mouse.setCenterLock(enabled);
        this.refreshCenterMarker();
    }

    /**
     * The chunk-picking mode holding the map: the settle flow until the player owns a chunk,
     * chunk administration after (itself inert while off).
     * @returns {SettleFlow|ClaimSelectionMode}
     */
    get chunkMode() {
        if (this.settleFlow.active) {
            return this.settleFlow;
        }
        return this.claimSelection;
    }

    /**
     * The center aim dot follows whichever chunk-picking mode is on, center-lock only.
     * @returns {void}
     */
    refreshCenterMarker() {
        const picking = this.chunkMode.active;
        this.centerMarkerLayer.setActive(this._centerLock && picking && this._viewMode !== ViewMode.WORLD);
    }

    /**
     * Eases the center-lock viewport `tiles` tiles from (tileX, tileY) along `direction` so
     * consecutive taps lay a line; a no-op off center-lock.
     * @param {number} tileX
     * @param {number} tileY
     * @param {Direction} direction
     * @param {number} [tiles] - how many tiles to advance (default 1)
     * @returns {void}
     */
    advanceCenterLock(tileX, tileY, direction, tiles = 1) {
        if (!this._centerLock) {
            return;
        }
        // Absolute next-tile center so rapid taps don't drift.
        const targetTileX = tileX + Direction.dx(direction) * tiles;
        const targetTileY = tileY + Direction.dy(direction) * tiles;
        this.viewport.glideTo({
            x: targetTileX * TILE_SIZE + TILE_SIZE / 2,
            y: targetTileY * TILE_SIZE + TILE_SIZE / 2,
        });
    }

    /**
     * @param {AbstractMessage} message
     */
    sendMessage(message) {
        this.session.sendMessage(message);
    }

    /**
     * Writes a player setting: optimistic local update plus the server write, so the echoed
     * update is a no-op. Skips when the value is already current.
     * @param {number} key
     * @param {number} value
     * @returns {void}
     */
    updatePlayerSetting(key, value) {
        if (this.cache.view("playerSettings").get(key) === value) {
            return;
        }
        this.cache.writer("playerSettings").set(key, value);
        this.sendMessage(new SetPlayerSettingMessage(key, value));
    }

    /**
     * Writes a new custom order for the mod tools (toolbar drag reorder): optimistic local update
     * plus the server write, so the echoed update is a no-op.
     * @param {AbstractTool[]} tools - the mod tools in their new display order
     * @returns {void}
     */
    setModToolOrder(tools) {
        const toolIds = tools.map(tool => tool.id);
        this.cache.writer("playerSettings").setToolOrder(toolIds);
        this.sendMessage(new SetPlayerSettingsToolOrderMessage(toolIds));
    }

    /**
     * @param {AbstractEvent} event
     * @param {number} [bytes] - protobuf bytes this event arrived as (dev only; 0 for the
     *     inner events of a re-published bundle, already counted in the bundle)
     */
    publishEvent(event, bytes=0) {
        if (DEV && BROWSER) {
            this._bytesReceived = (this._bytesReceived || 0) + bytes;
            // Logging every event costs a DevTools stack capture each and retains the payloads;
            // only in debug mode, and batch events cut to their leading column entries.
            if (bytes > 0 && this._debugMode) {
                // this event's size, then the session total
                console.log(`↓ [${formatBytes(bytes).padStart(6)} / ${formatBytes(this._bytesReceived).padStart(6)}]`, event.constructor.name, eventLogView(event));
            }
        }
        if (event instanceof ChunkSyncEvent) {
            // A chunk-sync bundle: queue each inner event, exploded to its per-delta events so
            // the drain budget counts real applications, not envelopes. Sync events are distinct
            // types (e.g. ObjectSyncEvent vs ObjectInsertEvent), so handlers can already tell a load
            // from a live change.
            for (const inner of event.events) {
                let deltas;
                if (inner instanceof AbstractBatchEvent) {
                    deltas = inner.explode();
                } else {
                    deltas = [inner];
                }
                for (const delta of deltas) {
                    this._queueEvent(delta);
                }
            }
            return;
        }
        if (event instanceof ChunkUnsubscribeEvent) {
            if (this._queuedCountByChunk.has(event.chunk)) {
                // The chunk left the viewport before its queued sync applied: the unsubscribe
                // wipes that state anyway, so drop the queue's share of it first.
                this._pendingEvents = this._pendingEvents.filter(pending => pending.chunk !== event.chunk);
                this._queuedCountByChunk.delete(event.chunk);
            }
            // Tearing down a chunk's entries and sprites is heavy too: a prune pass drops many
            // chunks at once, so unsubscribes ride the budgeted drain, one chunk per event.
            this._queueEvent(event);
            return;
        }
        if (event.chunk !== undefined && this._queuedCountByChunk.has(event.chunk)) {
            // The event's chunk still has queued sync: apply behind it, keeping per-chunk order.
            this._queueEvent(event);
            return;
        }
        this._applyEvent(event);
    }

    /**
     * Queues one event for the budgeted drain, gating its chunk's later events behind it.
     * @private
     * @param {AbstractEvent} event
     * @returns {void}
     */
    _queueEvent(event) {
        this._pendingEvents.push(event);
        const count = this._queuedCountByChunk.get(event.chunk);
        let nextCount;
        if (count === undefined) {
            nextCount = 1;
        } else {
            nextCount = count + 1;
        }
        this._queuedCountByChunk.set(event.chunk, nextCount);
    }

    /**
     * Applies queued events for up to {@link DRAIN_BUDGET_MS} per frame.
     * @private
     * @returns {void}
     */
    _drainPendingEvents() {
        if (this._pendingEvents.length === 0) {
            return;
        }
        const started = performance.now();
        let applied = 0;
        while (applied < this._pendingEvents.length && performance.now() - started < DRAIN_BUDGET_MS) {
            const event = this._pendingEvents[applied];
            applied += 1;
            const count = this._queuedCountByChunk.get(event.chunk);
            if (count === 1) {
                this._queuedCountByChunk.delete(event.chunk);
            } else {
                this._queuedCountByChunk.set(event.chunk, count - 1);
            }
            this._applyEvent(event);
        }
        this._pendingEvents.splice(0, applied);
    }

    /**
     * Fans one event out to every client consumer: the cache writers first (readers see settled
     * state), then the mods, layers, and host listeners. State reactions ride cache subscriptions.
     * @private
     * @param {AbstractEvent} event
     * @returns {void}
     */
    _applyEvent(event) {
        if (event instanceof AbstractBatchEvent) {
            // A chunk's packed deltas: replay each as the per-delta event handlers already expect.
            for (const inner of event.explode()) {
                this._applyEvent(inner);
            }
            return;
        }
        this.cache.onEvent(event);
        for (const mod of this.modRegistry.clientMods) {
            mod.onEvent(event, this);
        }
        this.drawLayerRegistry.dispatchEvent(event);
        // The status HUD isn't a viewport draw layer, so feed it chunk events directly.
        this.statusLayer.onEvent(event);
        this._eventListeners.notify(event);
    }

    /**
     * Registers a host event listener, called with every applied event; the listener filters by
     * instanceof (transient outcomes like ClaimResultEvent never enter the state tree).
     * @param {function(AbstractEvent): void} listener
     * @returns {function(): void} unsubscribe
     */
    onEvent(listener) {
        return this._eventListeners.add(listener);
    }

    /**
     * Builds the derived client bundle of every behavior-driven object type; each piece comes from
     * the type's create* hook or the derived default.
     * @private
     * @returns {ObjectTypeClientBundle[]}
     */
    _buildBundles() {
        return this.modRegistry.objectTypes
            .filter(type => !type.bespokeClient)
            .map(type => {
                let drawLayer = type.createDrawLayer(this);
                if (drawLayer === null) {
                    drawLayer = new ObjectDrawLayer(type);
                }
                let ghostLayer = type.createGhostLayer(this);
                if (ghostLayer === null) {
                    ghostLayer = new ObjectGhostLayer(type);
                }
                let tool = type.createTool(this, ghostLayer);
                if (tool === null) {
                    tool = new ObjectTool(this, type, ghostLayer);
                }
                return new ObjectTypeClientBundle(type, drawLayer, ghostLayer, tool);
            });
    }

    /**
     * Handles a context gesture (long press, or right-click on desktop) on the tile while
     * tool-less: offers it to the client mods' bespoke content. World mode only.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    handleObjectHold(tileX, tileY) {
        for (const mod of this.modRegistry.clientMods) {
            if (mod.onObjectHold(tileX, tileY, this)) {
                return;
            }
        }
    }

    /**
     * Handles a left-click (tool-less) tap on the tile: offers it to the client mods' bespoke
     * content first, that content being hit-tested finer than a tile, then the first placed
     * object's tapAction, then the item under the pointer. World mode only.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {void}
     */
    handleObjectTap(tileX, tileY) {
        for (const mod of this.modRegistry.clientMods) {
            if (mod.onObjectTap(tileX, tileY, this)) {
                return;
            }
        }
        for (const bundle of this.bundles) {
            const record = this.objects.objectAt(tileX, tileY, bundle.type);
            if (record === null || bundle.type.tapAction === null) {
                continue;
            }
            bundle.type.tapAction(record, this.session, this);
            return;
        }
        // Touch has no hover, so a tap on nothing tappable names the item under it.
        this.itemInspectLayer.tapAt();
    }

    /**
     * Routes an inspect hover to every client mod and drives the inspect-highlight layer with the
     * highlights they return (empty clears it); an item under the cursor outranks them.
     * @param {number|null} tileX
     * @param {number|null} tileY
     * @returns {void}
     */
    handleInspect(tileX, tileY) {
        const derived = [];
        if (tileX !== null) {
            for (const bundle of this.bundles) {
                const record = this.objects.objectAt(tileX, tileY, bundle.type);
                if (record !== null) {
                    derived.push(new InspectHighlight(record.tileX, record.tileY, record.data.direction, bundle.type));
                }
            }
        }
        const bespoke = this.modRegistry.clientMods
            .flatMap(mod => mod.onInspect(tileX, tileY, this));
        this.itemInspectLayer.setInspecting(tileX !== null);
        this.inspectLayer.show(derived.concat(bespoke));
    }

    /**
     * Gathers and merges every mod's settings categories, validating player control keys.
     * @returns {SettingCategory[]}
     */
    settingsCategories() {
        const contributions = this._coreSettingsCategories()
            .concat(this.modRegistry.clientMods.flatMap(mod => mod.settingsCategories(this)));
        const categories = SettingCategory.merge(contributions);
        const controls = categories.flatMap(category => category.controls);
        for (const control of controls) {
            if (!(control instanceof AbstractPlayerSettingControl)) {
                continue;
            }
            const entry = this.modRegistry.playerSettingEntry(control.key);
            if (entry === undefined) {
                throw new Error(`Settings control "${control.label}" targets unregistered player setting key ${control.key}`);
            }
            if (!entry.clientWritable) {
                throw new Error(`Settings control "${control.label}" targets server-authoritative player setting key ${control.key}`);
            }
            if (control instanceof PlayerSettingChoice) {
                if (control.options.length !== entry.optionCount) {
                    throw new Error(`Settings control "${control.label}" offers ${control.options.length} options but player setting key ${control.key} allows ${entry.optionCount}`);
                }
            } else if (control instanceof PlayerSettingToggle) {
                if (entry.optionCount !== 2) {
                    throw new Error(`Settings control "${control.label}" toggles player setting key ${control.key}, which allows ${entry.optionCount} values`);
                }
            } else {
                throw new Error(`Settings control "${control.label}" has an unknown control type`);
            }
        }
        return categories;
    }

    /**
     * Stacks the counter list under the status message, and stands it down while the top bar
     * owns the top edge.
     * @private
     * @returns {void}
     */
    _layoutTopLeft() {
        const offset = Math.max(this._topBarHeight, SafeArea.insets().top);
        this.counterListLayer.setTopOffset(offset + this._statusHeight, this._topBarHeight > 0);
    }

    /**
     * Repaints every themed HUD layer after a palette swap.
     * @private
     * @returns {void}
     */
    _restyleHud() {
        for (const layer of this._themedLayers) {
            layer.restyle();
        }
    }

    /**
     * The engine's own settings section: device toggles and the theme picker.
     * @private
     * @returns {SettingCategory[]}
     */
    _coreSettingsCategories() {
        return [
            new SettingCategory("Display", DISPLAY_CATEGORY_ORDER, [
                new DeviceSettingToggle(DEVICE_SETTING_FULLSCREEN, "Fullscreen", false, on => Fullscreen.setEnabled(on)),
                new DeviceSettingToggle(DEVICE_SETTING_REDUCED_MOTION, "Reduced motion", ReducedMotion.devicePrefers(), on => ReducedMotion.setEnabled(on)),
                new DeviceSettingToggle(DEVICE_SETTING_MOBILE, "Touchscreen input", Mobile.devicePrefers(), on => Mobile.setEnabled(on)),
                new DeviceSettingToggle(DEVICE_SETTING_TERRAIN, "Terrain", TERRAIN_ENABLED_DEFAULT, on => this.setTerrainEnabled(on)),
                new DeviceSettingChoice(DEVICE_SETTING_THEME, "Theme", THEME_NAMES, THEME_DEFAULT, index => applyTheme(index)),
                new DeviceSettingChoice(DEVICE_SETTING_FPS_CAP, "Frame rate cap", FPS_CAP_NAMES, FPS_CAP_DEFAULT, index => this.setFpsCap(index)),
            ]),
        ];
    }

    /**
     * Paces the render ticker to the chosen frame-rate option.
     * @param {number} index into FPS_CAP_VALUES
     * @returns {void}
     */
    setFpsCap(index) {
        this.app.ticker.maxFPS = FPS_CAP_VALUES[index];
    }

    /**
     * Rebakes the ground's palette and rescatters its details, keeping the biome classification: a
     * retuned color, shade or dither.
     * @returns {void}
     */
    repaintTerrain() {
        this.terrainLayer.repaint();
        this.terrainDetailLayer.repaint();
    }

    /**
     * Reclassifies as well as repaints: a retuned noise channel, biome range or blend width changes
     * which biome a tile is, which the cached bakes would otherwise keep answering.
     * @returns {void}
     */
    retuneTerrain() {
        if (this.terrain !== null) {
            this.terrain.invalidate();
        }
        this.repaintTerrain();
    }

    /**
     * Shows or hides the ground and its scattered details.
     * @param {boolean} enabled
     * @returns {void}
     */
    setTerrainEnabled(enabled) {
        this.terrainLayer.setEnabled(enabled);
        this.terrainDetailLayer.setEnabled(enabled);
    }

    /**
     * Gathers the tools every client mod makes available.
     * @returns {AbstractTool[]}
     */
    modTools() {
        const tools = this._bespokeModTools.concat(this.bundles.map(bundle => bundle.tool));
        return applyToolOrder(tools, this.cache.view("playerSettings").toolOrder());
    }

}
