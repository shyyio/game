import {TickEndEvent} from "@/common/CoreEvents.js";
import {SetViewportMessage, SetInspectedObjectsMessage, DeleteObjectMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {PlayerSettingsToolOrderSyncEvent} from "@/common/PlayerSettingsToolOrderEvents.js";
import {GameSettingsSyncEvent} from "@/common/GameSettingsEvents.js";
import {
    AddFriendMessage, AddFriendByCodeMessage, RemoveFriendMessage, SetPlayerSettingMessage,
    SetPlayerSettingsToolOrderMessage,
} from "@/common/PlayerMessages.js";
import {WelcomeEvent} from "@/common/PlayerEvents.js";
import {ClaimChunkMessage, UnclaimChunkMessage, SetChunkPermissionMessage} from "@/common/ClaimMessages.js";
import {WireRegistry} from "@/common/wire.js";
import {GameEngine, TICK_PHASE_ORDER} from "@/sim/GameEngine.js";
import {EventBus} from "@/sim/EventBus.js";
import {SettingsCache, PlayerSettingsCache, PLAYER_SETTING_RECORD} from "@/common/SettingsCache.js";
import {PlayerSettingsToolOrderCache, PLAYER_SETTINGS_TOOL_ORDER_RECORD} from "@/common/PlayerSettingsToolOrderCache.js";
import {ChunkClaims, CHUNK_CLAIM_RECORD} from "@/sim/ChunkClaims.js";
import {PlayerRegistry, PLAYER_RECORD, FRIEND_RECORD} from "@/sim/PlayerRegistry.js";
import {PlayerDirectory} from "@/sim/PlayerDirectory.js";
import {ClaimAdmin} from "@/sim/ClaimAdmin.js";
import {SessionViews} from "@/sim/SessionViews.js";
import {CHUNK_SIZE, DEFAULT_TICK_MS, GameSettingsKey} from "@/common/constants.js";
import {GameMetrics} from "@/sim/GameMetrics.js";
import {migrateSnapshot} from "@/common/saveMigrations.js";
import {WorldNoise} from "@/common/WorldNoise.js";
import {Terrain} from "@/common/Terrain.js";

export class Game {

    /**
     * @param {ModRegistry} modRegistry
     * @param {GameEngine} [simEngine] - the simulation engine; defaults to a fresh GameEngine
     * @param {AbstractSaveStore} [saveStore] - persists/restores the world; omitted when saving is off
     * @param {AbstractMetricsStore} [metricsStore] - persists metrics facts; omitted when metrics is off
     * @param {number} [tickMs] - real-time length of one sim tick, published as GameSettingsKey.TICK_MS
     * @param {number} [seed] - world seed for a fresh world; a loaded save's seed replaces it
     */
    constructor(modRegistry, simEngine, saveStore, metricsStore, tickMs = DEFAULT_TICK_MS, seed = 0) {
        this.modRegistry = modRegistry;
        this.saveStore = saveStore;

        /**
         * The simulation engine the tick pipeline runs through.
         * @type {GameEngine}
         */
        this.simEngine = simEngine === undefined ? new GameEngine(modRegistry) : simEngine;
        // Publish each domain event synchronously to the sessions subscribed to its chunk topic.
        this.simEngine.setEventSink(
            event => this.bus.publish(event),
            chunk => this.bus.hasChunkSubscribers(chunk),
        );

        /**
         * Protobuf wire codec registry, shared by sessions to encode/decode
         * messages and events.
         * @type {WireRegistry}
         */
        this.wire = new WireRegistry(modRegistry);

        /**
         * Topic pub/sub owning the session registry and event routing.
         * @type {EventBus}
         */
        this.bus = new EventBus();

        /**
         * @type {SettingsCache}
         */
        this.gameSettings = new SettingsCache();
        this.gameSettings.set(GameSettingsKey.CHUNK_SIZE, CHUNK_SIZE);
        this.gameSettings.set(GameSettingsKey.TICK_MS, tickMs);

        /**
         * Seeded terrain noise; the client builds its own twin from GameSettingsKey.SEED.
         * @type {WorldNoise}
         */
        this.noise = null;

        /**
         * Tile -> biome over the noise; the client derives the same from its twin.
         * @type {Terrain}
         */
        this.terrain = null;
        this._applySeed(seed);

        /**
         * @type {PlayerSettingsCache}
         */
        this.playerSettings = new PlayerSettingsCache();

        /**
         * @type {PlayerSettingsToolOrderCache}
         */
        this.toolOrder = new PlayerSettingsToolOrderCache();

        /**
         * @type {PlayerRegistry}
         */
        this.players = new PlayerRegistry();

        /**
         * @type {ChunkClaims}
         */
        this.claims = new ChunkClaims();

        /**
         * Username disclosure and the friendships that widen it.
         * @type {PlayerDirectory}
         */
        this.playerDirectory = new PlayerDirectory(this);

        /**
         * The claim, unclaim and permission requests over those claims.
         * @type {ClaimAdmin}
         */
        this.claimAdmin = new ClaimAdmin(this);
        this.simEngine.setPlacementGate((playerId, chunk) => this.claimAdmin.canBuildIn(playerId, chunk));
        this.simEngine.setChunkOwnerResolver(chunk => this.claims.ownerOf(chunk));

        /**
         * The chunks, overworld and inspect menus each session is looking at.
         * @type {SessionViews}
         */
        this.sessionViews = new SessionViews(this);

        /**
         * The whole metrics surface: fact recording, session lengths, queries, live pushes.
         * @type {GameMetrics}
         */
        this.metrics = new GameMetrics(metricsStore, modRegistry, this.bus, this.simEngine);

        /**
         * Core message class -> its handler; anything absent falls through to metrics, then mods.
         * @type {Map<Function, function(AbstractSession, AbstractMessage): void>}
         * @private
         */
        this._coreMessageHandlers = new Map([
            [SetViewportMessage, (session, message) => this.sessionViews.setViewport(session, message.chunks)],
            [SetInspectedObjectsMessage, (session, message) => this.sessionViews.setInspects(session, message.objectIds)],
            [OverworldRequestMessage, (session, message) => this.sessionViews.sendOverworldSnapshot(session, message)],
            [ClaimChunkMessage, (session, message) => this.claimAdmin.claim(session, message.chunk)],
            [UnclaimChunkMessage, (session, message) => this.claimAdmin.unclaim(session, message.chunk, message.clear === 1)],
            [SetChunkPermissionMessage, (session, message) => this.claimAdmin.setPermission(session, message.chunk, message.permission)],
            [AddFriendMessage, (session, message) => this.playerDirectory.addFriend(session, message.playerId)],
            [AddFriendByCodeMessage, (session, message) => this.playerDirectory.addFriendByCode(session, message.code)],
            [RemoveFriendMessage, (session, message) => this.playerDirectory.removeFriend(session, message.playerId)],
            [SetPlayerSettingMessage, (session, message) => this._handleSetPlayerSetting(session, message.key, message.value)],
            [SetPlayerSettingsToolOrderMessage, (session, message) => this._handleSetToolOrder(session, message.toolIds)],
        ]);
    }

    async init() {
        await this.simEngine.init();
    }

    /**
     * @returns {number} the world seed
     */
    get seed() {
        return this.simEngine.seed;
    }

    /**
     * @private
     * @param {number} seed
     * @returns {void}
     */
    _applySeed(seed) {
        this.noise = new WorldNoise(seed, this.modRegistry.noiseChannels);
        this.terrain = new Terrain(this.noise, this.modRegistry.biomes);
        this.simEngine.seed = seed;
        this.gameSettings.set(GameSettingsKey.SEED, seed);
    }

    // ---- Persistence ----

    /**
     * The whole world as one snapshot: engine state plus every record table.
     * @returns {object}
     */
    serialize() {
        const snapshot = this.simEngine.snapshots.serialize();
        snapshot.records = [
            ...this.players.serializeRecords(),
            this.claims.serializeRecords(),
            this.playerSettings.serializeRecords(),
            this.toolOrder.serializeRecords(),
        ];
        for (const mod of this.modRegistry.simMods) {
            snapshot.records.push(...mod.serializeRecords());
        }
        return snapshot;
    }

    /**
     * Persists the whole world through the save store.
     * @returns {Promise<void>}
     */
    async save() {
        await this.saveStore.save(this.serialize());
    }

    /**
     * Restores the world from the save store, if a save exists.
     * Older formats are upgraded here, the only boundary that accepts a foreign-shaped snapshot.
     * @returns {Promise<boolean>} whether a save was loaded
     */
    async load() {
        const stored = await this.saveStore.load();
        if (stored === null) {
            return false;
        }
        const snapshot = migrateSnapshot(stored);
        this.simEngine.snapshots.deserialize(snapshot);
        this._applySeed(this.simEngine.seed);
        const records = snapshot.records === undefined ? [] : snapshot.records;
        const byName = new Map(records.map(table => [table.name, table]));
        this.players.deserializeRecords(byName.get(PLAYER_RECORD), byName.get(FRIEND_RECORD));
        this.claims.deserializeRecords(byName.get(CHUNK_CLAIM_RECORD));
        this.playerSettings.deserializeRecords(byName.get(PLAYER_SETTING_RECORD));
        this.toolOrder.deserializeRecords(byName.get(PLAYER_SETTINGS_TOOL_ORDER_RECORD));
        for (const mod of this.modRegistry.simMods) {
            mod.deserializeRecords(byName);
        }
        return true;
    }

    // ---- Sessions ----

    /**
     * @param {AbstractSession} session
     */
    connect(session) {
        const sessionId = this.bus.addSession(session);
        session.setId(sessionId);
        this.playerDirectory.connect(sessionId);
        // Local and test sessions carry ids the registry has never seen; the server registers its
        // players before connecting them, so this is a no-op there.
        this.players.ensure(session.playerId);

        this.metrics.onConnect(session);

        // Before any sync, so a mod granting this player something starts it in the sync snapshot.
        for (const mod of this.modRegistry.simMods) {
            mod.onSessionConnect(session, this);
        }

        this._syncPlayerSettings(session);
        this._syncToolOrder(session);
        this._syncGameSettings(session);
        this._syncPlayerState(session);
    }

    /**
     * Sends a fresh session its identity, its own claims, and its friends.
     * @param {AbstractSession} session
     * @private
     */
    _syncPlayerState(session) {
        const record = this.players.byId(session.playerId);
        this.bus.publishTo(session.id, new WelcomeEvent(record.playerId, record.maxChunks, record.friendCode));
        this.playerDirectory.syncUsernames(session.id, [session.playerId]);
        this.claimAdmin.syncOwnClaims(session);
        this.playerDirectory.syncFriendList(session.id, session.playerId);
    }

    _syncGameSettings(session) {
        this.bus.publishTo(session.id, new GameSettingsSyncEvent(this.gameSettings.snapshot()));
    }

    /**
     * @param {AbstractSession} session
     * @private
     */
    _syncPlayerSettings(session) {
        this.bus.publishTo(session.id, new PlayerSettingsSyncEvent(this.playerSettings.snapshot(session.playerId)));
    }

    /**
     * @param {AbstractSession} session
     * @private
     */
    _syncToolOrder(session) {
        this.bus.publishTo(session.id, new PlayerSettingsToolOrderSyncEvent(this.toolOrder.get(session.playerId)));
    }

    /**
     * @param {number} sessionId
     */
    disconnect(sessionId) {
        // Before removeSession, so the leave fact still resolves the session's playerId.
        this.metrics.onDisconnect(sessionId);

        this.bus.removeSession(sessionId);
        this.playerDirectory.disconnect(sessionId);
        // After the removal, so mod farewells fan out to the remaining sessions alone.
        for (const mod of this.modRegistry.simMods) {
            mod.onSessionDisconnect(sessionId, this);
        }
        this.simEngine.invalidateObservers();
    }

    // ---- Messages ----

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     */
    dispatchMessage(message, session) {
        // Core messages are handled here; the rest go to the mods' session handlers, then the
        // engine's registered handlers.
        const handler = this._coreMessageHandlers.get(message.constructor);
        if (handler !== undefined) {
            handler(session, message);
            return;
        }

        if (this.metrics.handleMessage(session, message)) {
            return;
        }

        for (const mod of this.modRegistry.simMods) {
            if (mod.onSessionMessage(message, session, this)) {
                return;
            }
        }

        this.simEngine.applyMessage(message, session.playerId);

        // Close menus after the object is actually deleted, never before.
        if (message instanceof DeleteObjectMessage) {
            this.sessionViews.closeInspect(message.id);
        }
    }

    /**
     * Writes one client-writable player setting. Unknown keys, server-authoritative keys
     * (progress, unlocks), and out-of-range values drop silently, like a failed validate.
     * @param {AbstractSession} session
     * @param {number} key
     * @param {number} value
     * @private
     */
    _handleSetPlayerSetting(session, key, value) {
        const entry = this.modRegistry.playerSettingEntry(key);
        if (entry === undefined || !entry.clientWritable) {
            return;
        }
        if (value < 0 || value >= entry.optionCount) {
            return;
        }
        this.playerSettings.set(session.playerId, key, value);
        this.bus.publishTo(session.id, new PlayerSettingsUpdateEvent(key, value));
        for (const mod of this.modRegistry.simMods) {
            mod.onPlayerSettingWritten(session, key, value, this);
        }
    }

    /**
     * Stores the player's toolbar order and echoes it back to the session that set it.
     * @param {AbstractSession} session
     * @param {number[]} toolIds
     * @private
     */
    _handleSetToolOrder(session, toolIds) {
        this.toolOrder.set(session.playerId, toolIds);
        this.bus.publishTo(session.id, new PlayerSettingsToolOrderSyncEvent(toolIds));
    }

    // ---- Tick ----

    /**
     * @param {TickPhase} phase
     */
    tick(phase) {
        this.simEngine.tick(phase);
    }

    /**
     * Runs one whole tick: every phase in order, then the post-tick drains.
     * @returns {void}
     */
    runTick() {
        for (const phase of TICK_PHASE_ORDER) {
            this.simEngine.tick(phase);
        }
        // better-sqlite3 is synchronous, so the write runs inline despite the async/await wrapping.
        this.metrics.flushAndPush();
        this.postTick();
    }

    postTick() {
        for (const mod of this.modRegistry.simMods) {
            mod.onTick(this);
        }
        this.sessionViews.dispatchInspectEvents();
        // Last thing in the tick: every client learns the clock it just reached, so nothing on the
        // client has to time ticks for itself.
        this.bus.publishToAll(new TickEndEvent(this.simEngine.clock));
    }
}
