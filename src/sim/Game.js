import {TickEndEvent} from "@/common/CoreEvents.js";
import {SetViewportMessage, SetInspectedObjectsMessage, DeleteObjectMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {PlayerSettingsToolOrderSyncEvent} from "@/common/PlayerSettingsToolOrderEvents.js";
import {GameSettingsSyncEvent, GameSettingsUpdateEvent} from "@/common/GameSettingsEvents.js";
import {
    AddFriendMessage, AddFriendByCodeMessage, RemoveFriendMessage, SetPlayerSettingMessage,
    SetPlayerSettingsToolOrderMessage,
} from "@/common/PlayerMessages.js";
import {WelcomeEvent} from "@/common/PlayerEvents.js";
import {ClaimChunkMessage, UnclaimChunkMessage, SetChunkPermissionMessage} from "@/common/ClaimMessages.js";
import {WireRegistry} from "@/common/wire.js";
import {GameEngine} from "@/sim/GameEngine.js";
import {EventBus} from "@/sim/EventBus.js";
import {SettingsCache, PlayerSettingsCache, PLAYER_SETTING_TABLE} from "@/common/SettingsCache.js";
import {PlayerSettingsToolOrderCache, PLAYER_SETTINGS_TOOL_ORDER_TABLE} from "@/common/PlayerSettingsToolOrderCache.js";
import {ChunkClaims, CHUNK_CLAIM_TABLE} from "@/sim/ChunkClaims.js";
import {PlayerRegistry, PLAYER_TABLE, FRIEND_TABLE} from "@/sim/PlayerRegistry.js";
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
        this.gameSettings.setValue(GameSettingsKey.CHUNK_SIZE, CHUNK_SIZE);
        this.gameSettings.setValue(GameSettingsKey.TICK_MS, tickMs);

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
        this.simEngine.setChunkOwnership(this.claimAdmin);

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
            [SetInspectedObjectsMessage, (session, message) => this.sessionViews.setInspects(session, message.objectRefs)],
            [OverworldRequestMessage, (session, message) => this.sessionViews.publishOverworldSnapshot(session, message)],
            [ClaimChunkMessage, (session, message) => this.claimAdmin.claim(session, message.chunkKey)],
            [UnclaimChunkMessage, (session, message) => this.claimAdmin.unclaim(session, message.chunkKey, message.clear === 1)],
            [SetChunkPermissionMessage, (session, message) => this.claimAdmin.setPermission(session, message.chunkKey, message.permission)],
            [AddFriendMessage, (session, message) => this.playerDirectory.addFriend(session, message.playerRef)],
            [AddFriendByCodeMessage, (session, message) => this.playerDirectory.addFriendByCode(session, message.code)],
            [RemoveFriendMessage, (session, message) => this.playerDirectory.removeFriend(session, message.playerRef)],
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
        this.gameSettings.setValue(GameSettingsKey.SEED, seed);
    }

    /**
     * The whole world as one snapshot: engine state plus every table.
     * @returns {object}
     */
    serialize() {
        const snapshot = this.simEngine.snapshots.serialize();
        snapshot.tables = [
            ...this.players.serializeTables(),
            this.claims.serializeTables(),
            this.playerSettings.serializeTables(),
            this.toolOrder.serializeTables(),
        ];
        for (const mod of this.modRegistry.simMods) {
            for (const table of mod.serializeTables()) {
                snapshot.tables.push(table);
            }
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
        this.loadSnapshot(migrateSnapshot(stored));
        return true;
    }

    /**
     * Restores the world from a snapshot at the current format.
     * @param {object} snapshot
     * @returns {void}
     */
    loadSnapshot(snapshot) {
        this.simEngine.snapshots.deserialize(snapshot);
        this._applySeed(this.simEngine.seed);
        const tables = snapshot.tables === undefined ? [] : snapshot.tables;
        const byName = new Map(tables.map(table => [table.name, table]));
        this.players.deserializeTables(byName.get(PLAYER_TABLE), byName.get(FRIEND_TABLE));
        this.claims.deserializeTables(byName.get(CHUNK_CLAIM_TABLE));
        this.playerSettings.deserializeTables(byName.get(PLAYER_SETTING_TABLE));
        this.toolOrder.deserializeTables(byName.get(PLAYER_SETTINGS_TOOL_ORDER_TABLE));
        for (const mod of this.modRegistry.simMods) {
            mod.deserializeTables(byName);
        }
    }

    /**
     * Changes the real-time length of a tick and tells every client, which read it for rates.
     * @param {number} tickMs
     * @returns {void}
     */
    setTickMs(tickMs) {
        this.gameSettings.setValue(GameSettingsKey.TICK_MS, tickMs);
        this.bus.publishToAll(new GameSettingsUpdateEvent(GameSettingsKey.TICK_MS, tickMs));
    }

    /**
     * @param {AbstractSession} session
     */
    connect(session) {
        const sessionRef = this.bus.addSession(session);
        session.setSessionRef(sessionRef);
        this.playerDirectory.connect(sessionRef);
        // Local and test sessions carry ids the registry has never seen; the server registers its
        // players before connecting them, so this is a no-op there.
        this.players.ensure(session.playerRef);

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
        const entry = this.players.getPlayerByRef(session.playerRef);
        this.bus.publishTo(session.sessionRef, new WelcomeEvent(entry.playerRef, entry.maxChunks, entry.friendCode));
        this.playerDirectory.syncUsernames(session.sessionRef, [session.playerRef]);
        this.claimAdmin.syncOwnClaims(session);
        this.playerDirectory.syncFriendList(session.sessionRef, session.playerRef);
    }

    _syncGameSettings(session) {
        this.bus.publishTo(session.sessionRef, new GameSettingsSyncEvent(this.gameSettings.getSnapshot()));
    }

    /**
     * @param {AbstractSession} session
     * @private
     */
    _syncPlayerSettings(session) {
        this.bus.publishTo(session.sessionRef, new PlayerSettingsSyncEvent(this.playerSettings.getPlayerSnapshot(session.playerRef)));
    }

    /**
     * @param {AbstractSession} session
     * @private
     */
    _syncToolOrder(session) {
        this.bus.publishTo(session.sessionRef, new PlayerSettingsToolOrderSyncEvent(this.toolOrder.getToolOrderByPlayerRef(session.playerRef)));
    }

    /**
     * @param {number} sessionRef
     */
    disconnect(sessionRef) {
        // Before removeSession, so the leave fact still resolves the session's playerRef.
        this.metrics.onDisconnect(sessionRef);

        this.bus.removeSession(sessionRef);
        this.playerDirectory.disconnect(sessionRef);
        // After the removal, so mod farewells fan out to the remaining sessions alone.
        for (const mod of this.modRegistry.simMods) {
            mod.onSessionDisconnect(sessionRef, this);
        }
        this.simEngine.invalidateSubscriptions();
    }

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

        this.simEngine.applyMessage(message, session.playerRef);

        // Close menus after the object is actually deleted, never before.
        if (message instanceof DeleteObjectMessage) {
            this.sessionViews.closeInspect(message.objectRef);
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
        const entry = this.modRegistry.findPlayerSettingEntryByKey(key);
        if (entry === undefined || !entry.clientWritable) {
            return;
        }
        if (value < 0 || value >= entry.optionCount) {
            return;
        }
        this.playerSettings.setPlayerValue(session.playerRef, key, value);
        this.bus.publishTo(session.sessionRef, new PlayerSettingsUpdateEvent(key, value));
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
        this.toolOrder.setToolOrder(session.playerRef, toolIds);
        this.bus.publishTo(session.sessionRef, new PlayerSettingsToolOrderSyncEvent(toolIds));
    }

    /**
     * Runs one whole tick, then the post-tick drains.
     * @returns {void}
     */
    runTick() {
        this.simEngine.tick();
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
