import {coreTextureAtlases} from "@/client/CoreTextures/assets.js";
import {TextureRegistry} from "@/client/layers/TextureRegistry.js";
import {SpriteOverrideStore} from "@/client/spriteEditor/SpriteOverrideStore.js";
import {DrawLayerRegistry} from "@/client/layers/DrawLayerRegistry.js";
import {ToolRotation} from "@/client/input/ToolRotation.js";
import {EraserTool} from "@/client/input/EraserTool.js";
import {SetInspectedObjectsMessage} from "@/common/CoreMessages.js";
import {ClaimResultFeedback} from "@/client/hud/ClaimResultFeedback.js";
import {SetPlayerSettingMessage, SetPlayerSettingsToolOrderMessage} from "@/common/PlayerMessages.js";
import {applyToolOrder} from "@/client/input/ToolOrder.js";
import {ChunkClaimsDrawLayer} from "@/client/layers/ChunkClaimsDrawLayer.js";
import {ChunkSubscription} from "@/client/ChunkSubscription.js";
import {EventQueue} from "@/client/EventQueue.js";
import {Camera} from "@/client/Camera.js";
import {CenterLock} from "@/client/CenterLock.js";
import {ViewModeController} from "@/client/ViewModeController.js";
import {SettingsMenu} from "@/client/SettingsMenu.js";
import {Hud} from "@/client/Hud.js";
import {ClientCache} from "@/client/state/ClientCache.js";
import {CHUNK_CLAIMS_SCHEMA, ChunkClaimsWriter, ChunkClaimsView} from "@/client/state/ChunkClaimsState.js";
import {PLAYERS_SCHEMA, PlayersWriter, PlayersView} from "@/client/state/PlayersState.js";
import {PLAYER_SETTINGS_SCHEMA, GAME_SETTINGS_SCHEMA, PlayerSettingsWriter, GameSettingsWriter, PlayerSettingsView, GameSettingsView} from "@/client/state/SettingsState.js";
import {WORKER_ASSIGNMENTS_SCHEMA, WorkerAssignmentsWriter, WorkerAssignmentsView} from "@/client/state/WorkerAssignmentsState.js";
import {METRICS_SCHEMA, MetricsWriter, MetricsView} from "@/client/state/MetricsState.js";
import {CLOCK_SCHEMA, ClockWriter, ClockView} from "@/client/state/ClockState.js";
import {OBJECTS_SCHEMA, ObjectsWriter} from "@/client/state/ObjectsState.js";
import {INSPECT_SCHEMA, InspectWriter, InspectView} from "@/client/state/InspectState.js";
import {Direction, GameSettingsKey} from "@/common/constants.js";
import {WorldNoise} from "@/common/WorldNoise.js";
import {Terrain} from "@/common/Terrain.js";
import {chunkId} from "@/common/util.js";
import {OVERWORLD_SCHEMA, OverworldWriter, OverworldView} from "@/client/state/OverworldState.js";
import {OverworldDrawLayer} from "@/client/layers/OverworldDrawLayer.js";
import {GridDrawLayer} from "@/client/layers/GridDrawLayer.js";
import {TerrainDrawLayer} from "@/client/layers/TerrainDrawLayer.js";
import {TerrainDetailLayer} from "@/client/layers/TerrainDetailLayer.js";
import {PlacementFeedbackLayer} from "@/client/layers/PlacementFeedbackLayer.js";
import {InspectLayer} from "@/client/layers/InspectLayer.js";
import {ItemInspectLayer} from "@/client/layers/ItemInspectLayer.js";
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
import {ChunkSelectionLayer} from "@/client/layers/ChunkSelectionLayer.js";
import {ClaimFrontierDrawLayer} from "@/client/layers/ClaimFrontierDrawLayer.js";
import {ClaimSelectionMode} from "@/client/input/ClaimSelectionMode.js";
import {SettleFlow} from "@/client/input/SettleFlow.js";
import {ChunkCursor} from "@/client/input/ChunkCursor.js";
import {advanceAnimationFrame} from "@/client/layers/animation.js";
import {
    SESSION_STATUS_CONNECTED, SESSION_STATUS_RECONNECTING, SESSION_STATUS_SERVER_SHUTDOWN, SESSION_STATUS_SUPERSEDED,
    SESSION_STATUS_REJECTED,
} from "@/client/RemoteSession.js";

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
        this._buildSharedWorldLayers();
        this._buildTools();
        this.hud = new Hud(this);
        this.subscription = new ChunkSubscription(this.viewport, this.cache, this.session, this.hud.statusLayer);
        this.events = new EventQueue(this);
        this.camera = new Camera(this);
        this.centerLock = new CenterLock(this);
        this.viewMode = new ViewModeController(this);
        this.settingsMenu = new SettingsMenu(this);
        this._buildChunkLayers();
        this._buildModSurface();
        this._registerWorldLayers();
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
     * Builds the shared placement state tools read.
     * @private
     * @returns {void}
     */
    _buildTools() {
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
        // Shared placement-feedback layer, driven by whichever tool is active.
        this.placementFeedbackLayer = new PlacementFeedbackLayer();
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
     * Builds the chunk claim, selection and frontier layers.
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
        this.hud.addModLayers(this.modRegistry.clientMods.flatMap(mod => mod.hudLayers(this)));
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
     * Builds the chunk-picking input modes and the claim feedback that listens with them.
     * @private
     * @returns {void}
     */
    _buildInputModes() {
        // The selected chunk, shared by the chunk-picking modes below.
        this.chunkCursor = new ChunkCursor(this);
        // Chunk administration input mode controller.
        this.claimSelection = new ClaimSelectionMode(this);
        this.events.onEvent(event => this.claimSelection.onEvent(event));
        // The first-claim flow, owning the state before the player holds any chunk.
        this.settleFlow = new SettleFlow(this);
        this.events.onEvent(event => this.settleFlow.onEvent(event));
        // Toast/confirm-dialog feedback for claim/unclaim rejections.
        this.claimResultFeedback = new ClaimResultFeedback(this);
        this.events.onEvent(event => this.claimResultFeedback.onEvent(event));
        this.events.onEvent(event => this.hud.friendsPanelLayer.onEvent(event));
    }

    /**
     * Reacts to the remote session's connection status; local sessions never call this. Shows a
     * persistent status message while down, clears it and resyncs once reconnected.
     * @param {string} status
     * @returns {void}
     */
    onConnectionStatusChange(status) {
        if (status === SESSION_STATUS_RECONNECTING) {
            this.hud.statusLayer.setOverride("Reconnecting…");
        } else if (status === SESSION_STATUS_SERVER_SHUTDOWN) {
            this.hud.statusLayer.setOverride("Server is restarting…");
        } else if (status === SESSION_STATUS_SUPERSEDED) {
            this.hud.statusLayer.setOverride("Signed in on another device");
        } else if (status === SESSION_STATUS_REJECTED) {
            this.hud.statusLayer.setOverride("Could not reconnect. Refresh the page");
        } else if (status === SESSION_STATUS_CONNECTED) {
            this.hud.statusLayer.clearOverride();
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
        this.hud.statusLayer.reset();
        this.subscription.resync();
        this.hud.notify("Reconnected");
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
     * Every button the client mods offer on a player.
     * @param {number} playerId
     * @returns {PlayerAction[]}
     */
    modPlayerActions(playerId) {
        return this.modRegistry.clientMods.flatMap(mod => mod.playerActions(playerId, this));
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
     * @returns {Promise<void>}
     */
    async init() {
        await this.textureRegistry.load(coreTextureAtlases.concat(this.modRegistry.textureAtlases));
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

        this.hud.mount();

        this.viewport.on("moved", () => this.viewportMoved());
        // "zoomed" fires mid-wheel with the over-zoomed scale, before clampZoom restores it;
        // reading the viewport here would briefly see an expanded area and subscribe chunks
        // that aren't really on screen. The chunk update rides "moved", which fires after the
        // clamp with the settled scale, so only the view mode (thresholds well inside the zoom
        // limits, never mid-clamp) keys off "zoomed".
        this.viewport.on("zoomed", () => this.viewMode.update());
        // Scale-only glides emit "zoomed" but never "moved"; the settled zoom (post-clamp)
        // catches the data feed up here.
        this.viewport.on("zoomed-end", () => this.viewportMoved());
        // While a pan is in progress, drop the rotate buttons out of hit-testing so
        // a finger that crosses one keeps panning instead of being captured by it.
        this.viewport.on("drag-start", () => this.hud.rotateButtonsLayer.setInteractive(false));
        this.viewport.on("drag-end", () => this.hud.rotateButtonsLayer.setInteractive(true));
        this.app.ticker.add(() => this._tickAnimations());
        this.subscription.viewportMoved();
        this.viewMode.update();
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
        this.events.drain();
        this.drawLayerRegistry.tick(
            advanceAnimationFrame(deltaMS),
            deltaMS,
            this.subscription.visibleChunks(),
        );
    }

    /**
     * Routes viewport movement to the mode's data feed: chunk subscriptions, or overworld
     * snapshot refreshes when zoomed past the map band.
     * @returns {void}
     */
    viewportMoved() {
        this.subscription.viewportMoved();
        this.hud.viewportMoved();
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
     * Gathers the tools every client mod makes available.
     * @returns {AbstractTool[]}
     */
    modTools() {
        const tools = this._bespokeModTools.concat(this.bundles.map(bundle => bundle.tool));
        return applyToolOrder(tools, this.cache.view("playerSettings").toolOrder());
    }

}
