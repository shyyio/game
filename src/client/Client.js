import Mouse from "@/client/Mouse.js";
import {TextureRegistry} from "@/client/TextureRegistry.js";
import {DrawLayerRegistry} from "@/client/DrawLayerRegistry.js";
import {PlayerSettings} from "@/client/PlayerSettings.js";
import {GameSettings} from "@/client/GameSettings.js";
import {MiniMenuLayer} from "@/client/MiniMenuLayer.js";
import {RotateButtonsLayer} from "@/client/RotateButtonsLayer.js";
import {ToolbarLayer} from "@/client/ToolbarLayer.js";
import {ToolRotation} from "@/client/ToolRotation.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {ChunkSyncEvent} from "@/common/CoreEvents.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {TILE_SIZE, snapToChunk, MAP_MODE_SCALE_THRESHOLD, CHUNK_UNSUBSCRIBE_DELAY_MS} from "@/client/constants.js";
import {CHUNK_SIZE, Direction} from "@/common/constants.js";
import {chunkId} from "@/common/util.js";
import {GridDrawLayer} from "@/client/GridDrawLayer.js";
import {MaskDrawLayer} from "@/client/MaskDrawLayer.js";
import {PlacementFeedbackLayer} from "@/client/PlacementFeedbackLayer.js";
import {InspectLayer} from "@/client/InspectLayer.js";
import {ClientCache} from "@/client/ClientCache.js";
import {ItemDrawLayer} from "@/client/ItemDrawLayer.js";
import {ConnectionDrawLayer} from "@/client/ConnectionDrawLayer.js";
import {StatusMessageLayer} from "@/client/StatusMessageLayer.js";
import {advanceAnimationFrame} from "@/client/animation.js";
import {DEV, BROWSER} from "@/common/env.js";

function formatBytes(n) {
    const text = n > 1024 ? `${Math.round(n / 1024)}K` : `${n}B`;
    return text.padStart(5);
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
        this.drawLayerRegistry = new DrawLayerRegistry(modRegistry);
        this.playerSettings = new PlayerSettings();
        this.gameSettings = new GameSettings();
        this.miniMenuLayer = new MiniMenuLayer(viewport);
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
        // Shared cross-mod object index, fed by mods' insert/delete handling and queried by
        // tools/layers for tile lookups, placement collision, and connection rendering.
        this.cache = new ClientCache();
        // The single shared item layer: belts drive their computed-position items imperatively;
        // resting out-port items render here automatically from the port-item events.
        this.itemLayer = new ItemDrawLayer(modRegistry.itemTextures);
        // A removed object's resting out-port item sprites go with it.
        this.cache.onRemove(record => this.itemLayer.dropPorts(record));
        // The single shared connection-stub layer, derived from the cache each frame.
        this.connectionLayer = new ConnectionDrawLayer();
        // Top-left connection/chunk-loading status overlay. A static screen-space HUD on
        // app.stage (sibling of the viewport), so it never pans or zooms with the world.
        this.statusLayer = new StatusMessageLayer();
        this.statusLayer.setConnecting();

        this.drawLayerRegistry.add(new GridDrawLayer());
        this.drawLayerRegistry.add(new MaskDrawLayer());
        this.drawLayerRegistry.add(this.placementFeedbackLayer);
        this.drawLayerRegistry.add(this.inspectLayer);
        this.drawLayerRegistry.add(this.itemLayer);
        this.drawLayerRegistry.add(this.connectionLayer);

        // The chunks currently requested from the server (subscribed): the visible chunks
        // plus any that recently panned out and are awaiting a throttled unsubscribe.
        this._requestedChunks = new Set();
        this._lastVisibleKey = null;
        this._unsubscribeTimer = null;
        this._mapMode = false;
        this._onMapModeChange = null;
        this._centerLock = false;
        this._debugMode = false;
    }

    /**
     * Toggles debug mode, showing or hiding debug-only draw layers.
     * @returns {void}
     */
    toggleDebugMode() {
        this._debugMode = !this._debugMode;
        this.drawLayerRegistry.setDebugMode(this._debugMode);
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
        await this.textureRegistry.loadFromModRegistry(this.modRegistry);

        this.drawLayerRegistry.layers.forEach(layer => {
            layer.textureRegistry = this.textureRegistry;
            layer.viewport = this.viewport;
            layer.cache = this.cache;
            this.viewport.addChild(layer);
        });

        this.toolbarLayer.textureRegistry = this.textureRegistry;
        this.app.stage.addChild(this.miniMenuLayer);
        this.app.stage.addChild(this.rotateButtonsLayer);
        this.app.stage.addChild(this.toolbarLayer);
        this.app.stage.addChild(this.statusLayer);

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
        this.drawLayerRegistry.tick(advanceAnimationFrame(), this.app.ticker.deltaMS);
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
        visible.forEach(chunk => {
            if (!this._requestedChunks.has(chunk)) {
                this._requestedChunks.add(chunk);
                added = true;
            }
        });
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
        this._requestedChunks.forEach(chunk => {
            if (!visible.has(chunk)) {
                this._requestedChunks.delete(chunk);
                removed = true;
            }
        });
        if (removed) {
            this._sendViewport(false);
        }
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
            console.log(`↓ [${formatBytes(this._bytesReceived)}]`, event.constructor.name, event);
        }
        if (event instanceof ChunkSyncEvent) {
            // A chunk-sync bundle: replay each inner event through the normal path.
            // Sync events are distinct types (e.g. BeltSyncEvent vs BeltInsertEvent),
            // so handlers can already tell a load from a live change.
            event.events.forEach(inner => this.publishEvent(inner));
            return;
        }
        if (event instanceof PlayerSettingsSyncEvent) {
            Object.entries(event.values).forEach(([key, value]) => {
                this.playerSettings.update(Number(key), value);
            });
            return;
        }
        if (event instanceof PlayerSettingsUpdateEvent) {
            this.playerSettings.update(event.key, event.value);
            return;
        }
        if (event instanceof GameSettingsSyncEvent) {
            Object.entries(event.values).forEach(([key, value]) => {
                this.gameSettings.update(Number(key), value);
            });
            return;
        }
        if (event instanceof GameSettingsUpdateEvent) {
            this.gameSettings.update(event.key, event.value);
            return;
        }
        this.modRegistry.handleClientEvent(event, this);
        this.drawLayerRegistry.publishEvent(event);
        // The status HUD isn't a viewport draw layer, so feed it chunk events directly.
        this.statusLayer.onEvent(event);
    }
}
