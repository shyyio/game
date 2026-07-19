import Mouse from "@/client/Mouse.js";
import {TextureRegistry} from "@/client/TextureRegistry.js";
import {DrawLayerRegistry} from "@/client/DrawLayerRegistry.js";
import {PlayerSettings} from "@/client/PlayerSettings.js";
import {GameSettings} from "@/client/GameSettings.js";
import {MiniMenuLayer} from "@/client/MiniMenuLayer.js";
import {InspectPanelLayer} from "@/client/InspectPanelLayer.js";
import {RotateButtonsLayer} from "@/client/RotateButtonsLayer.js";
import {ToolbarLayer} from "@/client/ToolbarLayer.js";
import {ToolRotation} from "@/client/ToolRotation.js";
import {EraserTool} from "@/client/EraserTool.js";
import {SetViewportMessage, SetInspectedObjectsMessage} from "@/common/CoreMessages.js";
import {ChunkSyncEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";
import {InspectHeartbeatEvent, InspectClosedEvent} from "@/common/InspectEvents.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {LaborAssignmentEvent} from "@/common/LaborEvents.js";
import {LaborAssignmentCache} from "@/client/LaborAssignmentCache.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {
    TILE_SIZE,
    snapToChunk,
    viewportChunks,
    MAP_MODE_SCALE_THRESHOLD,
    CHUNK_UNSUBSCRIBE_DELAY_MS,
} from "@/client/constants.js";
import {CHUNK_SIZE, Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {GridDrawLayer} from "@/client/GridDrawLayer.js";
import {PlacementFeedbackLayer} from "@/client/PlacementFeedbackLayer.js";
import {InspectLayer} from "@/client/InspectLayer.js";
import {ClientCache} from "@/client/ClientCache.js";
import {ClientCacheSync} from "@/client/ClientCacheSync.js";
import {ObjectTypeClientBundle} from "@/client/ObjectTypeClientBundle.js";
import {ObjectDrawLayer} from "@/client/ObjectDrawLayer.js";
import {ObjectGhostLayer} from "@/client/ObjectGhostLayer.js";
import {ObjectTool} from "@/client/ObjectTool.js";
import {InspectHighlight} from "@/client/InspectHighlight.js";
import {ItemDrawLayer} from "@/client/ItemDrawLayer.js";
import {ConnectionDrawLayer} from "@/client/ConnectionDrawLayer.js";
import {WorkerDrawLayer} from "@/client/WorkerDrawLayer.js";
import {LaborDebugLayer} from "@/client/LaborDebugLayer.js";
import {LaborBadgeLayer} from "@/client/LaborBadgeLayer.js";
import {StatusMessageLayer} from "@/client/StatusMessageLayer.js";
import {advanceAnimationFrame} from "@/client/animation.js";
import {DEV, BROWSER} from "@/common/env.js";

// Frame time spent applying queued sync events; the rest wait for the next frame.
const DRAIN_BUDGET_MS = 6;

// Leading entries shown per column when logging a columnar batch event.
const LOG_BATCH_ITEMS = 5;

function formatBytes(n) {
    const text = n > 1024 ? `${Math.round(n / 1024)}K` : `${n}B`;
    return text.padStart(5);
}

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
        this.playerSettings = new PlayerSettings();
        this.gameSettings = new GameSettings();
        this.miniMenuLayer = new MiniMenuLayer(viewport);
        // Screen-space panels for open machine menus; fed by InspectHeartbeatEvents.
        this.inspectPanelLayer = new InspectPanelLayer(app);
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
        // Shared cross-mod object index, written by ClientCacheSync (derived types) and bespoke
        // mods (belts), queried by tools/layers for tile lookups, placement collision, and
        // connection rendering.
        this.cache = new ClientCache();
        // Sole cache writer for derived object types; first in the event dispatch chain.
        this.cacheSync = new ClientCacheSync(modRegistry, this.cache);
        // The single shared item layer: belts drive their computed-position items imperatively;
        // resting out-port items render here automatically from the port-item events.
        this.itemLayer = new ItemDrawLayer(modRegistry.itemTextures);
        // The single shared connection-stub layer, derived from the cache as objects change.
        this.connectionLayer = new ConnectionDrawLayer();
        // Machine staffing mirrored from the sim's assignment events, shared by the labor layers.
        this.laborAssignments = new LaborAssignmentCache();
        // Commuting worker figures for manned machines, routed over the cached road tiles.
        this.workerLayer = new WorkerDrawLayer(this.laborAssignments);
        // Debug overlay: road components, attachments, and assignments; hidden outside debug mode.
        this.laborDebugLayer = new LaborDebugLayer(this.laborAssignments);
        // Staffing dots over manned machines (one per consumed worker).
        this.laborBadgeLayer = new LaborBadgeLayer(this.laborAssignments);
        // Top-left connection/chunk-loading status overlay. A static screen-space HUD on
        // app.stage (sibling of the viewport), so it never pans or zooms with the world.
        this.statusLayer = new StatusMessageLayer();
        this.statusLayer.setConnecting();

        // The derived client surface (draw layer + ghost + tool) of every behavior-driven type;
        // bespoke types (belt) bring their own through their client mod.
        this.bundles = this._buildBundles();
        for (const bundle of this.bundles) {
            this.drawLayerRegistry.add(bundle.drawLayer);
            this.drawLayerRegistry.add(bundle.ghostLayer);
        }
        for (const layer of this.modRegistry.clientMods.flatMap(mod => mod.drawLayers(this))) {
            this.drawLayerRegistry.add(layer);
        }
        this.drawLayerRegistry.add(new GridDrawLayer());
        this.drawLayerRegistry.add(this.placementFeedbackLayer);
        this.drawLayerRegistry.add(this.inspectLayer);
        this.drawLayerRegistry.add(this.itemLayer);
        this.drawLayerRegistry.add(this.connectionLayer);
        this.drawLayerRegistry.add(this.workerLayer);
        this.drawLayerRegistry.add(this.laborDebugLayer);
        this.drawLayerRegistry.add(this.laborBadgeLayer);

        // One bind per layer: sets the shared cache and registers whichever cache hooks the layer
        // overrides — before init, since cache writes can arrive while textures load.
        for (const layer of this.drawLayerRegistry.layers) {
            layer.bindCache(this.cache);
        }

        // The chunks currently requested from the server (subscribed): the visible chunks
        // plus any that recently panned out and are awaiting a throttled unsubscribe.
        this._requestedChunks = new Set();
        // Per-delta events awaiting the budgeted per-frame drain: a chunk-sync bundle explodes to
        // hundreds of cache writes + sprite builds. Later events queue only when their own chunk
        // still has queued sync (per-chunk order); everything else applies on arrival, so live
        // tick traffic for already-synced chunks can never pile up behind a loading burst.
        this._pendingEvents = [];
        // chunk -> its queued event count; a chunk with an entry gates its later events.
        this._queuedCountByChunk = new Map();
        this._lastVisibleKey = null;
        this._unsubscribeTimer = null;
        this._mapMode = false;
        this._onMapModeChange = null;
        this._centerLock = false;
        this._debugMode = false;
        // Machine ids (number) with open menus; sent to the game as the inspect set.
        this._inspectedObjects = new Set();
    }

    /**
     * Opens a machine's menu: subscribes to its per-tick inspect snapshots.
     * @param {number} objectId
     * @returns {void}
     */
    inspectObject(objectId) {
        this._inspectedObjects.add(objectId);
        this._sendInspectedObjects();
    }

    /**
     * Closes a machine's menu: drops its subscription and its panel.
     * @param {number} objectId
     * @returns {void}
     */
    unInspectObject(objectId) {
        if (!this._inspectedObjects.delete(objectId)) {
            return;
        }
        this.inspectPanelLayer.remove(objectId);
        this._sendInspectedObjects();
    }

    _sendInspectedObjects() {
        this.sendMessage(new SetInspectedObjectsMessage([...this._inspectedObjects]));
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
     * Registers the handler invoked when the client enters or leaves map mode.
     * @param {function(mapMode: boolean)} callback
     */
    onMapModeChange(callback) {
        this._onMapModeChange = callback;
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
        this.app.stage.addChild(this.miniMenuLayer);
        this.app.stage.addChild(this.rotateButtonsLayer);
        this.app.stage.addChild(this.toolbarLayer);
        this.app.stage.addChild(this.statusLayer);
        // Panels sit above every other HUD layer.
        this.app.stage.addChild(this.inspectPanelLayer);

        this.viewport.on("moved", () => this._updateViewportChunks());
        // "zoomed" fires mid-wheel with the over-zoomed scale, before clampZoom restores it;
        // reading the viewport here would briefly see an expanded area and subscribe chunks
        // that aren't really on screen. The chunk update rides "moved", which fires after the
        // clamp with the settled scale, so only map mode (threshold well inside the zoom
        // limits, never mid-clamp) keys off "zoomed".
        this.viewport.on("zoomed", () => this._updateMapMode());
        // While a pan is in progress, drop the rotate buttons out of hit-testing so
        // a finger that crosses one keeps panning instead of being captured by it.
        this.viewport.on("drag-start", () => this.rotateButtonsLayer.setInteractive(false));
        this.viewport.on("drag-end", () => this.rotateButtonsLayer.setInteractive(true));
        this.app.ticker.add(() => this._tickAnimations());
        this._updateViewportChunks();
        this._updateMapMode();
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
        this.drawLayerRegistry.tick(
            advanceAnimationFrame(),
            this.app.ticker.deltaMS,
            viewportChunks(this.viewport),
        );
    }

    /**
     * Switches between sprite and map (geometry) rendering when the viewport
     * scale crosses {@link MAP_MODE_SCALE_THRESHOLD}.
     * @private
     */
    _updateMapMode() {
        const mapMode = this.viewport.scale.x < MAP_MODE_SCALE_THRESHOLD;
        if (mapMode === this._mapMode) {
            return;
        }
        this._mapMode = mapMode;
        this.drawLayerRegistry.setMapMode(mapMode);
        if (this._onMapModeChange != null) {
            this._onMapModeChange(mapMode);
        }
    }

    /**
     * @private
     */
    _visibleChunks() {
        const x1 = this.viewport.left / TILE_SIZE;
        const y1 = this.viewport.top / TILE_SIZE;
        const x2 = this.viewport.right / TILE_SIZE;
        const y2 = this.viewport.bottom / TILE_SIZE;

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
        const visible = this._visibleChunks();
        const visibleKey = visible.slice().sort().join(";");
        if (visibleKey === this._lastVisibleKey) {
            return;
        }
        this._lastVisibleKey = visibleKey;

        // Subscribe to any newly visible chunks at once; chunks that left the viewport
        // stay requested until a throttled pass drops them.
        let added = false;
        for (const chunk of visible) {
            if (!this._requestedChunks.has(chunk)) {
                this._requestedChunks.add(chunk);
                added = true;
            }
        }
        if (added) {
            this._sendViewport(true);
        }
        this._scheduleUnsubscribe();
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
     * Schedules a throttled pass that unsubscribes chunks now outside the viewport, so a
     * quick pan back doesn't re-sync them. Runs at most once per delay while panning.
     * @private
     */
    _scheduleUnsubscribe() {
        if (this._unsubscribeTimer != null) {
            return;
        }
        this._unsubscribeTimer = setTimeout(() => {
            this._unsubscribeTimer = null;
            this._pruneHiddenChunks();
        }, CHUNK_UNSUBSCRIBE_DELAY_MS);
    }

    /**
     * Drops requested chunks that are no longer visible, resyncing if any left.
     * @private
     */
    _pruneHiddenChunks() {
        const visible = new Set(this._visibleChunks());
        let removed = false;
        for (const chunk of [...this._requestedChunks]) {
            if (!visible.has(chunk)) {
                this._requestedChunks.delete(chunk);
                removed = true;
            }
        }
        if (removed) {
            this._sendViewport(false);
        }
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
        // Absolute next-tile center so rapid taps don't drift; snap emits "moved"
        // each frame, so the chunk subscription refreshes via that listener.
        const targetTileX = tileX + Direction.dx(direction) * tiles;
        const targetTileY = tileY + Direction.dy(direction) * tiles;
        this.viewport.snap(
            targetTileX * TILE_SIZE + TILE_SIZE / 2,
            targetTileY * TILE_SIZE + TILE_SIZE / 2,
            {
                time: 120,
                ease: "easeOutBack", // single overshoot-and-settle
                forceStart: true,
                interrupt: true,
                removeOnComplete: true,
            },
        );
    }

    /**
     * @param {AbstractMessage} message
     */
    sendMessage(message) {
        this.session.sendMessage(message);
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
                console.log(`↓ [${formatBytes(bytes)} / ${formatBytes(this._bytesReceived)}]`, event.constructor.name, eventLogView(event));
            }
        }
        if (event instanceof ChunkSyncEvent) {
            // A chunk-sync bundle: queue each inner event, exploded to its per-delta events so
            // the drain budget counts real applications, not envelopes. Sync events are distinct
            // types (e.g. BeltSyncEvent vs BeltInsertEvent), so handlers can already tell a load
            // from a live change.
            for (const inner of event.events) {
                for (const delta of inner instanceof AbstractBatchEvent ? inner.explode() : [inner]) {
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
        this._queuedCountByChunk.set(event.chunk, count === undefined ? 1 : count + 1);
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
     * Applies one event to the client's consumers.
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
        if (event instanceof PlayerSettingsSyncEvent) {
            for (const [key, value] of Object.entries(event.values)) {
                this.playerSettings.update(Number(key), value);
            }
            return;
        }
        if (event instanceof PlayerSettingsUpdateEvent) {
            this.playerSettings.update(event.key, event.value);
            return;
        }
        if (event instanceof GameSettingsSyncEvent) {
            for (const [key, value] of Object.entries(event.values)) {
                this.gameSettings.update(Number(key), value);
            }
            return;
        }
        if (event instanceof GameSettingsUpdateEvent) {
            this.gameSettings.update(event.key, event.value);
            return;
        }
        if (event instanceof InspectHeartbeatEvent) {
            // Ignore a heartbeat in flight past a close, so it can't revive a shut panel.
            if (this._inspectedObjects.has(event.objectId)) {
                this.inspectPanelLayer.update(
                    event,
                    this.cacheSync.lastProducedOf(event.objectId),
                    this.cacheSync.positionOf(event.objectId),
                );
            }
            return;
        }
        if (event instanceof InspectClosedEvent) {
            this.unInspectObject(event.objectId);
            return;
        }
        this.dispatchEvent(event);
    }

    /**
     * Routes an event that landed off the wire to its in-process consumers.
     * @param {AbstractEvent} event
     */
    dispatchEvent(event) {
        this.cacheSync.onEvent(event);
        if (event instanceof LaborAssignmentEvent) {
            this.laborAssignments.onEvent(event);
        }
        for (const mod of this.modRegistry.clientMods) {
            mod.onEvent(event, this);
        }
        this.drawLayerRegistry.dispatchEvent(event);
        // The status HUD isn't a viewport draw layer, so feed it chunk events directly.
        this.statusLayer.onEvent(event);
    }

    /**
     * Builds the derived client bundle of every behavior-driven object type; each piece comes from
     * the type's create* hook or the derived default.
     * @private
     * @returns {ObjectTypeClientBundle[]}
     */
    _buildBundles() {
        return this.modRegistry.objectTypes
            .filter(type => type.behavior !== null)
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
     * Aggregates mini-menu entries from every client mod for the tile at (tileX, tileY).
     * @param {number} tileX
     * @param {number} tileY
     * @returns {MiniMenuEntry[]}
     */
    miniMenuEntries(tileX, tileY) {
        const derived = this.bundles.flatMap(bundle => {
            const record = this.cache.objectAt(tileX, tileY, bundle.type);
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
                const record = this.cache.objectAt(tileX, tileY, bundle.type);
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
     * Gathers the tools every client mod makes available.
     * @returns {AbstractTool[]}
     */
    modTools() {
        const bespoke = this.modRegistry.clientMods.flatMap(mod => mod.tools(this));
        return bespoke.concat(this.bundles.map(bundle => bundle.tool));
    }

}
