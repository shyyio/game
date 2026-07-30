import Mouse from "@/client/Mouse.js";
import {TextureRegistry} from "@/client/TextureRegistry.js";
import {DrawLayerRegistry} from "@/client/DrawLayerRegistry.js";
import {MiniMenuLayer} from "@/client/MiniMenuLayer.js";
import {InspectPanelLayer} from "@/client/InspectPanelLayer.js";
import {RotateButtonsLayer} from "@/client/RotateButtonsLayer.js";
import {ToolbarLayer} from "@/client/ToolbarLayer.js";
import {ToolRotation} from "@/client/ToolRotation.js";
import {EraserTool} from "@/client/EraserTool.js";
import {SetViewportMessage, SetInspectedObjectsMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {ChunkSyncEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";
import {ClaimChunkMessage, UnclaimChunkMessage} from "@/common/ClaimMessages.js";
import {AddFriendMessage, RemoveFriendMessage, SetPlayerSettingMessage} from "@/common/PlayerMessages.js";
import {ChunkClaimsDrawLayer} from "@/client/ChunkClaimsDrawLayer.js";
import {ClientCache} from "@/client/ClientCache.js";
import {CHUNK_CLAIMS_SCHEMA, ChunkClaimsWriter, ChunkClaimsView} from "@/client/ChunkClaimsState.js";
import {PLAYER_SETTINGS_SCHEMA, GAME_SETTINGS_SCHEMA, PlayerSettingsWriter, GameSettingsWriter, PlayerSettingsView, GameSettingsView} from "@/client/SettingsState.js";
import {WORKER_ASSIGNMENTS_SCHEMA, WorkerAssignmentsWriter, WorkerAssignmentsView} from "@/client/WorkerAssignmentsState.js";
import {OBJECTS_SCHEMA, ObjectsWriter} from "@/client/ObjectsState.js";
import {INSPECT_SCHEMA, InspectWriter, InspectView} from "@/client/InspectState.js";
import {
    TILE_SIZE,
    snapToChunk,
    viewportChunks,
    ViewMode,
    MAP_MODE_SCALE_THRESHOLD,
    OVERWORLD_SCALE_THRESHOLD,
    OVERWORLD_CHUNK_TTL_MS,
    OVERWORLD_REFRESH_THROTTLE_MS,
} from "@/client/constants.js";
import {CHUNK_SIZE, REGION_SIZE, Direction} from "@/common/constants.js";
import {chunkCenter, chunkId, formatBytes, REGION_HALF} from "@/common/util.js";
import {OVERWORLD_SCHEMA, OverworldRect, OverworldWriter, OverworldView} from "@/client/OverworldState.js";
import {OverworldDrawLayer} from "@/client/OverworldDrawLayer.js";
import {GridDrawLayer} from "@/client/GridDrawLayer.js";
import {PlacementFeedbackLayer} from "@/client/PlacementFeedbackLayer.js";
import {InspectLayer} from "@/client/InspectLayer.js";
import {ObjectsView} from "@/client/ObjectsState.js";
import {ObjectTypeClientBundle} from "@/client/ObjectTypeClientBundle.js";
import {ObjectDrawLayer} from "@/client/ObjectDrawLayer.js";
import {ObjectGhostLayer} from "@/client/ObjectGhostLayer.js";
import {ObjectTool} from "@/client/ObjectTool.js";
import {InspectHighlight} from "@/client/InspectHighlight.js";
import {ItemDrawLayer} from "@/client/ItemDrawLayer.js";
import {ConnectionDrawLayer} from "@/client/ConnectionDrawLayer.js";
import {WorkerDrawLayer} from "@/client/WorkerDrawLayer.js";
import {WorkerDebugLayer} from "@/client/WorkerDebugLayer.js";
import {WorkerBadgeLayer} from "@/client/WorkerBadgeLayer.js";
import {StatusMessageLayer} from "@/client/StatusMessageLayer.js";
import {FirstClaimLayer} from "@/client/FirstClaimLayer.js";
import {ChunkInfoPanelLayer} from "@/client/ChunkInfoPanelLayer.js";
import {ChunkSelectionLayer} from "@/client/ChunkSelectionLayer.js";
import {ClaimFrontierDrawLayer} from "@/client/ClaimFrontierDrawLayer.js";
import {ClaimSelectionMode} from "@/client/ClaimSelectionMode.js";
import {CenterMarkerLayer} from "@/client/CenterMarkerLayer.js";
import {MapButtonsLayer} from "@/client/MapButtonsLayer.js";
import {drawClaimIcon, drawHomeIcon} from "@/client/icons.js";
import {advanceAnimationFrame} from "@/client/animation.js";
import {DEV, BROWSER} from "@/common/env.js";
import {ListenerList} from "@/common/ListenerList.js";

// Frame time spent applying queued sync events; the rest wait for the next frame.
const DRAIN_BUDGET_MS = 6;

// Handed to the layer tick in overworld mode, where no chunks are mounted: building the real
// visible-chunk set at overworld scale would enumerate thousands of chunks per frame.
const NO_VISIBLE_CHUNKS = new Set();

// Leading entries shown per column when logging a columnar batch event.
const LOG_BATCH_ITEMS = 5;

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
        this.drawLayerRegistry = new DrawLayerRegistry();
        // The shared plain-data state tree: every namespace registers schema + writer + view,
        // every event fans out to every writer, and readers subscribe by path or query the views.
        // The objects writer registers first so object state lands before any reader; mods
        // register their namespaces in setup. The objects view doubles as the shared cross-mod
        // spatial index (`client.objects`), queried by tools/layers for tile lookups, placement
        // collision, and connection rendering.
        this.cache = new ClientCache();
        this.objects = new ObjectsView(modRegistry);
        this.cache.register("objects", OBJECTS_SCHEMA, new ObjectsWriter(modRegistry, this.cache), this.objects);
        this.cache.register("chunkClaims", CHUNK_CLAIMS_SCHEMA, new ChunkClaimsWriter(this.cache), new ChunkClaimsView());
        this.cache.register("gameSettings", GAME_SETTINGS_SCHEMA, new GameSettingsWriter(this.cache), new GameSettingsView());
        this.cache.register("playerSettings", PLAYER_SETTINGS_SCHEMA, new PlayerSettingsWriter(this.cache), new PlayerSettingsView());
        this.cache.register("workerAssignments", WORKER_ASSIGNMENTS_SCHEMA, new WorkerAssignmentsWriter(this.cache), new WorkerAssignmentsView());
        this.cache.register("overworld", OVERWORLD_SCHEMA, new OverworldWriter(this.cache), new OverworldView());
        this.cache.register("inspect", INSPECT_SCHEMA, new InspectWriter(this.cache), new InspectView());
        // The open-menu set rides to the sim as the inspect subscription, whoever changes it.
        this.cache.subscribe("inspect.openObjects", () => this._sendInspectedObjects());
        this.miniMenuLayer = new MiniMenuLayer(viewport);
        // Screen-space panels for open machine menus; fed by the inspect heartbeat state.
        this.inspectPanelLayer = new InspectPanelLayer(app, this.cache);
        // Rotate controls, toggled with the active tool by the host.
        this.rotateButtonsLayer = new RotateButtonsLayer(app, viewport);
        // Bottom-center tool bar; the host feeds it the tool list and reacts to selection.
        this.toolbarLayer = new ToolbarLayer(app, viewport);
        // Shared placement-feedback layer, driven by whichever tool is active.
        this.placementFeedbackLayer = new PlacementFeedbackLayer();
        // Shared hover-highlight layer, driven by mods' inspect hover.
        this.inspectLayer = new InspectLayer();
        // Shared placement facing, so orientation persists across tool switches.
        this.toolRotation = new ToolRotation();
        // The single shared item layer: belts drive their computed-position items imperatively;
        // resting out-port items render here automatically from the port-item events.
        this.itemLayer = new ItemDrawLayer(modRegistry.itemTextures);
        // The single shared connection-stub layer, derived from the cache as objects change.
        this.connectionLayer = new ConnectionDrawLayer();
        // Commuting worker figures for manned machines, routed over the cached road tiles.
        this.workerLayer = new WorkerDrawLayer(this.cache);
        // Debug overlay: road components, attachments, and assignments; hidden outside debug mode.
        this.workerDebugLayer = new WorkerDebugLayer(this.cache);
        // Staffing dots over manned machines (one per consumed worker).
        this.workerBadgeLayer = new WorkerBadgeLayer(this.cache);
        // Top-left connection/chunk-loading status overlay. A static screen-space HUD on
        // app.stage (sibling of the viewport), so it never pans or zooms with the world.
        this.statusLayer = new StatusMessageLayer();
        this.statusLayer.setConnecting();
        // Onboarding banner while the player holds no chunks.
        this.firstClaimLayer = new FirstClaimLayer(app);
        // Center-lock aim point for claim selection (mobile).
        this.centerMarkerLayer = new CenterMarkerLayer(app, viewport);
        // Contextual map-mode buttons (bottom-right); each toggles an input mode.
        this.mapButtonsLayer = new MapButtonsLayer(app);
        this.mapButtonsLayer.addButton("claimSelection", drawClaimIcon, () => this.claimSelection.toggle());
        // One-shot action, never a mode: setActive never fires.
        this.mapButtonsLayer.addButton("home", drawHomeIcon, () => this.glideHome());

        // Ownership borders for claimed chunks (map/overworld mode).
        this.chunkClaimsLayer = new ChunkClaimsDrawLayer(this.cache);
        this.drawLayerRegistry.add(this.chunkClaimsLayer);
        // Selected-chunk and hovered-chunk squares (map/overworld mode).
        this.chunkSelectionLayer = new ChunkSelectionLayer(this.cache.view("chunkClaims"));
        this.drawLayerRegistry.add(this.chunkSelectionLayer);
        // Dashed claim-frontier squares while claim selection mode is on.
        this.claimFrontierLayer = new ClaimFrontierDrawLayer(this.cache);
        this.drawLayerRegistry.add(this.claimFrontierLayer);
        // Chunk owner/claim panel for the hovered chunk (map mode).
        this.chunkInfoPanelLayer = new ChunkInfoPanelLayer(app, this.cache.view("chunkClaims"));
        this.chunkInfoPanelLayer.onClaim(chunk => this.sendMessage(new ClaimChunkMessage(chunk)));
        this.chunkInfoPanelLayer.onUnclaim(chunk => this.sendMessage(new UnclaimChunkMessage(chunk)));
        this.chunkInfoPanelLayer.onAddFriend(playerId => this.sendMessage(new AddFriendMessage(playerId)));
        this.chunkInfoPanelLayer.onUnfriend(playerId => this.sendMessage(new RemoveFriendMessage(playerId)));

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
        for (const layer of this.modRegistry.clientMods.flatMap(mod => mod.drawLayers(this))) {
            this.drawLayerRegistry.add(layer);
        }
        // The overworld renderer, active below the overworld zoom threshold.
        this.overworldLayer = new OverworldDrawLayer(modRegistry, this.cache);
        this.drawLayerRegistry.add(this.overworldLayer);
        this.drawLayerRegistry.add(new GridDrawLayer());
        this.drawLayerRegistry.add(this.placementFeedbackLayer);
        this.drawLayerRegistry.add(this.inspectLayer);
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
        this._viewMode = ViewMode.WORLD;
        this._onViewModeChange = null;
        this._lastOverworldRefreshMs = 0;
        this._centerLock = false;
        this._debugMode = false;
        // Host event listeners, the last stop of the event fan-out.
        this._eventListeners = new ListenerList();
        // Claim selection input mode controller.
        this.claimSelection = new ClaimSelectionMode(this);
        this.onEvent(event => this.claimSelection.onEvent(event));
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
        return [new EraserTool(this)];
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
        await this.textureRegistry.load(this.modRegistry.textureDefinitions);

        for (const layer of this.drawLayerRegistry.layers) {
            layer.textureRegistry = this.textureRegistry;
            layer.viewport = this.viewport;
            this.viewport.addChild(layer);
        }

        this.toolbarLayer.textureRegistry = this.textureRegistry;
        this.inspectPanelLayer.textureRegistry = this.textureRegistry;
        this.inspectPanelLayer.itemTextures = this.modRegistry.itemTextures;
        this.inspectPanelLayer.viewport = this.viewport;
        this.inspectPanelLayer.onClose(objectId => this.unInspectObject(objectId));
        this.app.stage.addChild(this.centerMarkerLayer);
        this.app.stage.addChild(this.mapButtonsLayer);
        this.app.stage.addChild(this.chunkInfoPanelLayer);
        this.app.stage.addChild(this.miniMenuLayer);
        this.app.stage.addChild(this.rotateButtonsLayer);
        this.app.stage.addChild(this.toolbarLayer);
        this.app.stage.addChild(this.statusLayer);
        this.app.stage.addChild(this.firstClaimLayer);
        // Panels sit above every other HUD layer.
        this.app.stage.addChild(this.inspectPanelLayer);

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
     * Drives sprite animation off the render loop, one frame per ticker tick. Passes
     * the frame's elapsed time so layers can interpolate continuous motion.
     * @private
     */
    _tickAnimations() {
        this._drainPendingEvents();
        // Derived once here rather than per layer: every chunk-culled layer needs the same set, and
        // rebuilding it per layer costs a chunkId per visible chunk each.
        let visibleChunks;
        if (this._viewMode === ViewMode.OVERWORLD) {
            visibleChunks = NO_VISIBLE_CHUNKS;
        } else {
            visibleChunks = viewportChunks(this.viewport);
        }
        this.drawLayerRegistry.tick(
            advanceAnimationFrame(),
            this.app.ticker.deltaMS,
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
        this.firstClaimLayer.setViewMode(mode);
        this.mapButtonsLayer.setViewMode(mode);
        for (const mod of this.modRegistry.clientMods) {
            mod.setViewMode(mode, this);
        }
        if (this._onViewModeChange != null) {
            this._onViewModeChange(mode);
        }
        this.claimSelection.onViewMode(previous);
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
        this._centerLock = enabled;
        // Draw layers before the input layer, so a hover Mouse emits renders with center-lock on.
        this.drawLayerRegistry.setCenterLock(enabled);
        Mouse.setCenterLock(enabled);
        this.claimSelection.updateIndicators();
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
     * Aggregates mini-menu entries for the tile: each client mod's object entries plus the
     * derived menu verbs. World mode only.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {MiniMenuEntry[]}
     */
    miniMenuEntries(tileX, tileY) {
        const derived = this.bundles.flatMap(bundle => {
            const record = this.objects.objectAt(tileX, tileY, bundle.type);
            if (record === null) {
                return [];
            }
            return bundle.type.menuVerbs.map(verb => verb.entry(bundle.type, record, this.session, this));
        });
        const bespoke = this.modRegistry.clientMods
            .flatMap(mod => mod.miniMenuEntries(tileX, tileY, this.session, this));
        return derived.concat(bespoke).sort((a, b) => b.rank - a.rank);
    }

    /**
     * Routes an inspect hover to every client mod and drives the inspect-highlight layer with the
     * highlights they return (empty clears it).
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
        this.inspectLayer.show(derived.concat(bespoke));
    }

    /**
     * Gathers the settings-menu controls every client mod contributes, validating each key
     * against the player-setting registry.
     * @returns {AbstractPlayerSettingControl[]}
     */
    settingsControls() {
        const controls = this.modRegistry.clientMods.flatMap(mod => mod.settingsControls(this));
        for (const control of controls) {
            const entry = this.modRegistry.playerSettingEntry(control.key);
            if (entry === undefined) {
                throw new Error(`Settings control "${control.label}" targets unregistered player setting key ${control.key}`);
            }
            if (!entry.clientWritable) {
                throw new Error(`Settings control "${control.label}" targets server-authoritative player setting key ${control.key}`);
            }
        }
        return controls;
    }

    /**
     * Gathers the tools every client mod makes available.
     * @returns {AbstractTool[]}
     */
    modTools() {
        const bespoke = this.modRegistry.clientMods.flatMap(mod => mod.tools(this));
        return bespoke.concat(this.bundles.map(bundle => bundle.tool));
    }

}
