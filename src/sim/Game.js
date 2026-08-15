import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent, TickEndEvent} from "@/common/CoreEvents.js";
import {SetViewportMessage, SetInspectedObjectsMessage, DeleteObjectMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {InspectClosedEvent} from "@/common/InspectEvents.js";
import {ObjectSyncEvent} from "@/common/ObjectEvents.js";
import {AbstractBatchEvent} from "@/common/AbstractBatchEvent.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {PlayerSettingsToolOrderSyncEvent} from "@/common/PlayerSettingsToolOrderEvents.js";
import {GameSettingsSyncEvent} from "@/common/GameSettingsEvents.js";
import {
    AddFriendMessage, AddFriendByCodeMessage, RemoveFriendMessage, SetPlayerSettingMessage,
    SetPlayerSettingsToolOrderMessage,
} from "@/common/PlayerMessages.js";
import {
    WelcomeEvent, PlayerNamesEvent, FriendListEvent, AddFriendByCodeResultEvent,
} from "@/common/PlayerEvents.js";
import {ClaimChunkMessage, UnclaimChunkMessage, SetChunkPermissionMessage} from "@/common/ClaimMessages.js";
import {
    OwnClaimsSyncEvent, ChunkClaimUpdateEvent, ClaimResultEvent, ClaimResult, ChunkPermission,
} from "@/common/ClaimEvents.js";
import {WireRegistry} from "@/common/wire.js";
import {GameEngine, TICK_PHASE_ORDER} from "@/sim/GameEngine.js";
import {EventBus} from "@/sim/EventBus.js";
import {SettingsCache, PlayerSettingsCache, PLAYER_SETTING_RECORD} from "@/common/SettingsCache.js";
import {PlayerSettingsToolOrderCache, PLAYER_SETTINGS_TOOL_ORDER_RECORD} from "@/common/PlayerSettingsToolOrderCache.js";
import {ChunkClaims, CHUNK_CLAIM_RECORD} from "@/sim/ChunkClaims.js";
import {PlayerRegistry, PLAYER_RECORD, FRIEND_RECORD} from "@/sim/PlayerRegistry.js";
import {CHUNK_SIZE, DEFAULT_TICK_MS, GameSettingsKey, PLAYER_ID_NONE} from "@/common/constants.js";
import {GameMetrics} from "@/sim/GameMetrics.js";
import {migrateSnapshot} from "@/common/saveMigrations.js";

export class Game {

    /**
     * @param {ModRegistry} modRegistry
     * @param {GameEngine} [simEngine] - the simulation engine; defaults to a fresh GameEngine
     * @param {AbstractSaveStore} [saveStore] - persists/restores the world; omitted when saving is off
     * @param {AbstractMetricsStore} [metricsStore] - persists metrics facts; omitted when metrics is off
     * @param {number} [tickMs] - real-time length of one sim tick, published as GameSettingsKey.TICK_MS
     */
    constructor(modRegistry, simEngine, saveStore, metricsStore, tickMs = DEFAULT_TICK_MS) {
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
        this.simEngine.setPlacementGate((playerId, chunk) => this._canBuildIn(playerId, chunk));
        this.simEngine.setChunkOwnerResolver(chunk => this.claims.ownerOf(chunk));

        /**
         * sessionId -> playerIds whose usernames the session already received.
         * @type {Map<number, Set<number>>}
         * @private
         */
        this._knownPlayersBySession = new Map();

        /**
         * The whole metrics surface: fact recording, session lengths, queries, live pushes.
         * @type {GameMetrics}
         */
        this.metrics = new GameMetrics(metricsStore, modRegistry, this.bus, this.simEngine);
    }

    /**
     * Whether a player may modify a chunk: the owner always may; unclaimed is off limits;
     * everyone else is gated by the chunk's permission. Mirrored client-side by
     * ChunkClaimsView.canBuildIn; keep both in sync.
     * @param {number} playerId
     * @param {number} chunk
     * @returns {boolean}
     * @private
     */
    _canBuildIn(playerId, chunk) {
        const owner = this.claims.ownerOf(chunk);
        if (owner === PLAYER_ID_NONE) {
            return false;
        }
        if (owner === playerId) {
            return true;
        }
        if (this.claims.permissionOf(chunk) === ChunkPermission.PERMISSION_ONLY_ME) {
            return false;
        }
        return this.players.isFriend(owner, playerId);
    }

    async init() {
        await this.simEngine.init();
    }

    // ---- Persistence ----

    /**
     * Persists the whole world through the save store.
     * @returns {Promise<void>}
     */
    async save() {
        const snapshot = this.simEngine.serialize();
        snapshot.records = [
            ...this.players.serializeRecords(),
            this.claims.serializeRecords(),
            this.playerSettings.serializeRecords(),
            this.toolOrder.serializeRecords(),
        ];
        await this.saveStore.save(snapshot);
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
        this.simEngine.deserialize(snapshot);
        const records = snapshot.records === undefined ? [] : snapshot.records;
        const byName = new Map(records.map(table => [table.name, table]));
        this.players.deserializeRecords(byName.get(PLAYER_RECORD), byName.get(FRIEND_RECORD));
        this.claims.deserializeRecords(byName.get(CHUNK_CLAIM_RECORD));
        this.playerSettings.deserializeRecords(byName.get(PLAYER_SETTING_RECORD));
        this.toolOrder.deserializeRecords(byName.get(PLAYER_SETTINGS_TOOL_ORDER_RECORD));
        return true;
    }

    // ---- Sessions ----

    /**
     * @param {AbstractSession} session
     */
    connect(session) {
        const sessionId = this.bus.addSession(session);
        session.setId(sessionId);
        this._knownPlayersBySession.set(sessionId, new Set());
        // Local and test sessions carry ids the registry has never seen; the server registers its
        // players before connecting them, so this is a no-op there.
        this.players.ensure(session.playerId);

        this.metrics.onConnect(session);

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
        this.syncUsernames(session.id, [session.playerId]);
        const ownChunks = [...this.claims.chunksOf(session.playerId)];
        const ownPermissions = ownChunks.map(chunk => this.claims.permissionOf(chunk));
        this.bus.publishTo(session.id, new OwnClaimsSyncEvent(ownChunks, ownPermissions));
        this._syncFriendList(session.id, session.playerId);
    }

    /**
     * Sends a session the usernames of the given players it has not seen yet. Usernames travel
     * on a need-to-know basis; every send of a player-bearing event routes its ids through here
     * first.
     * @param {number} sessionId
     * @param {Iterable<number>} playerIds
     * @returns {void}
     */
    syncUsernames(sessionId, playerIds) {
        const known = this._knownPlayersBySession.get(sessionId);
        const ids = [];
        const usernames = [];
        for (const playerId of playerIds) {
            if (playerId === PLAYER_ID_NONE || known.has(playerId)) {
                continue;
            }
            known.add(playerId);
            ids.push(playerId);
            usernames.push(this.players.byId(playerId).username);
        }
        if (ids.length > 0) {
            this.bus.publishTo(sessionId, new PlayerNamesEvent(ids, usernames));
        }
    }

    _syncGameSettings(session) {
        this.bus.publishTo(session.id, new GameSettingsSyncEvent(this.gameSettings.snapshot()));
    }

    /**
     * @param session {AbstractSession}
     * @private
     */
    _syncPlayerSettings(session) {
        this.bus.publishTo(session.id, new PlayerSettingsSyncEvent(this.playerSettings.snapshot(session.playerId)));
    }

    /**
     * @param session {AbstractSession}
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
        this._knownPlayersBySession.delete(sessionId);
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
        if (message instanceof SetViewportMessage) {
            this._setSessionViewport(session, message.chunks);
            return;
        }

        if (message instanceof SetInspectedObjectsMessage) {
            this._setSessionInspect(session, message.objectIds);
            return;
        }

        if (message instanceof OverworldRequestMessage) {
            this._sendOverworldSnapshot(session, message);
            return;
        }

        if (message instanceof ClaimChunkMessage) {
            this._handleClaim(session, message.chunk);
            return;
        }

        if (message instanceof UnclaimChunkMessage) {
            this._handleUnclaim(session, message.chunk, message.clear === 1);
            return;
        }

        if (message instanceof SetChunkPermissionMessage) {
            this._handleSetPermission(session, message.chunk, message.permission);
            return;
        }

        if (message instanceof AddFriendMessage) {
            this._handleAddFriend(session, message.playerId);
            return;
        }

        if (message instanceof AddFriendByCodeMessage) {
            const target = this.players.byFriendCode(message.code);
            const playerId = target === undefined ? PLAYER_ID_NONE : target.playerId;
            const found = playerId !== PLAYER_ID_NONE && playerId !== session.playerId;
            this._handleAddFriend(session, playerId);
            this.bus.publishTo(session.id, new AddFriendByCodeResultEvent(message.code, found));
            return;
        }

        if (message instanceof RemoveFriendMessage) {
            this.players.removeFriend(session.playerId, message.playerId);
            this._syncFriendLists(session, message.playerId);
            for (const mod of this.modRegistry.simMods) {
                mod.onFriendRemoved(session.playerId, message.playerId, this);
            }
            return;
        }

        if (message instanceof SetPlayerSettingMessage) {
            const entry = this.modRegistry.playerSettingEntry(message.key);
            // Unknown keys and server-authoritative keys (progress, unlocks) are never
            // client-writable; hostile input drops silently, like a failed validate.
            if (entry === undefined || !entry.clientWritable) {
                return;
            }
            if (message.value < 0 || message.value >= entry.optionCount) {
                return;
            }
            this.playerSettings.set(session.playerId, message.key, message.value);
            this.bus.publishTo(session.id, new PlayerSettingsUpdateEvent(message.key, message.value));
            for (const mod of this.modRegistry.simMods) {
                mod.onPlayerSettingWritten(session, message.key, message.value, this);
            }
            return;
        }

        if (message instanceof SetPlayerSettingsToolOrderMessage) {
            this.toolOrder.set(session.playerId, message.toolIds);
            this.bus.publishTo(session.id, new PlayerSettingsToolOrderSyncEvent(message.toolIds));
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
            this._closeInspect(message.id);
        }
    }

    // ---- Claims and friends ----

    /**
     * @param {AbstractSession} session
     * @param {number} chunk
     * @private
     */
    _handleClaim(session, chunk) {
        const record = this.players.byId(session.playerId);
        const result = this.claims.claim(session.playerId, chunk, record.maxChunks);
        if (result === ClaimResult.CLAIM_RESULT_OK) {
            this._publishClaimUpdate(session, chunk, session.playerId, this.claims.permissionOf(chunk));
        }
        this.bus.publishTo(session.id, new ClaimResultEvent(chunk, result));
    }

    /**
     * Sets a claimed chunk's permission; silently ignored if the sender does not own it (a stale
     * panel racing a concurrent unclaim), same as any other invariant the client already gates on.
     * @param {AbstractSession} session
     * @param {number} chunk
     * @param {number} permission - a ChunkPermission
     * @private
     */
    _handleSetPermission(session, chunk, permission) {
        const result = this.claims.setPermission(session.playerId, chunk, permission);
        if (result === ClaimResult.CLAIM_RESULT_OK) {
            this._publishClaimUpdate(session, chunk, session.playerId, permission);
        }
    }

    /**
     * Publishes a claim change to the chunk's viewers (owner name first, so the label resolves)
     * and targets it at the acting player's remaining sessions, which track their own claims
     * everywhere.
     * @param {AbstractSession} session
     * @param {number} chunk
     * @param {number} owner - the new owner, or PLAYER_ID_NONE for an unclaim
     * @param {number} permission - the chunk's ChunkPermission; meaningless for an unclaim
     * @private
     */
    _publishClaimUpdate(session, chunk, owner, permission) {
        const event = new ChunkClaimUpdateEvent(chunk, owner, permission);
        const subscribers = this.bus.chunkSubscribers(chunk);
        if (subscribers !== undefined) {
            for (const sessionId of subscribers) {
                this.syncUsernames(sessionId, [owner]);
            }
        }
        this.bus.publish(event);
        for (const sessionId of this.bus.sessionIdsOf(session.playerId)) {
            if (subscribers === undefined || !subscribers.has(sessionId)) {
                this.bus.publishTo(sessionId, event);
            }
        }
    }

    /**
     * @param {AbstractSession} session
     * @param {number} chunk
     * @private
     */
    _handleUnclaim(session, chunk, clear) {
        // A doomed unclaim (not owner, would split) rejects before the not-empty confirmation.
        const check = this.claims.unclaimCheck(session.playerId, chunk);
        if (check !== ClaimResult.CLAIM_RESULT_OK) {
            this.bus.publishTo(session.id, new ClaimResultEvent(chunk, check));
            return;
        }
        const solidIds = this._solidObjectIdsIn(chunk);
        // An unclaim must empty the chunk; without the clear confirmation it is rejected.
        if (solidIds.length > 0 && !clear) {
            this.bus.publishTo(session.id, new ClaimResultEvent(chunk, ClaimResult.CLAIM_RESULT_NOT_EMPTY));
            return;
        }
        const result = this.claims.unclaim(session.playerId, chunk);
        if (result === ClaimResult.CLAIM_RESULT_OK) {
            // Engine-originated deletes bypass the placement gate the now-unclaimed chunk holds.
            for (const objectId of solidIds) {
                this.simEngine.applyMessage(new DeleteObjectMessage(objectId), PLAYER_ID_NONE);
            }
            this._publishClaimUpdate(session, chunk, PLAYER_ID_NONE, ChunkPermission.PERMISSION_FRIENDS);
        }
        this.bus.publishTo(session.id, new ClaimResultEvent(chunk, result));
    }

    /**
     * The object ids of every solid object in a chunk; non-solid ground cover
     * (resources, water) stays out.
     * @private
     * @param {number} chunk
     * @returns {number[]}
     */
    _solidObjectIdsIn(chunk) {
        const ids = [];
        for (const event of this.simEngine.chunkSync(chunk)) {
            let inner = [event];
            if (event instanceof AbstractBatchEvent) {
                inner = event.explode();
            }
            for (const single of inner) {
                if (!(single instanceof ObjectSyncEvent)) {
                    continue;
                }
                const type = this.modRegistry.typeById(single.typeId);
                if (type.placement.solid) {
                    ids.push(single.id);
                }
            }
        }
        return ids;
    }

    /**
     * Befriends by playerId; an unknown id or self just re-sends the unchanged list.
     * @param {AbstractSession} session
     * @param {number} playerId
     * @private
     */
    _handleAddFriend(session, playerId) {
        if (this.players.has(playerId) && playerId !== session.playerId) {
            this.players.addFriend(session.playerId, playerId);
            this._syncFriendLists(session, playerId);
            return;
        }
        this._syncFriendList(session.id, session.playerId);
    }

    /**
     * Resyncs both sides of a friendship change: the acting session, and every connected
     * session of the (un)friended player, whose build rights just changed.
     * @param {AbstractSession} session
     * @param {number} friendId
     * @private
     */
    _syncFriendLists(session, friendId) {
        this._syncFriendList(session.id, session.playerId);
        for (const sessionId of this.bus.sessionIdsOf(friendId)) {
            this._syncFriendList(sessionId, friendId);
        }
    }

    /**
     * Sends one session a player's friend lists, both sides' names first.
     * @param {number} sessionId
     * @param {number} playerId
     * @private
     */
    _syncFriendList(sessionId, playerId) {
        const friendIds = [...this.players.byId(playerId).friends];
        const grantedByIds = this.players.grantedBy(playerId);
        this.syncUsernames(sessionId, friendIds.concat(grantedByIds));
        this.bus.publishTo(sessionId, new FriendListEvent(friendIds, grantedByIds));
    }

    // ---- Viewport ----

    /**
     * Diffs the session's viewport against the requested chunks so a pan only syncs the delta.
     * @param {AbstractSession} session
     * @param {number[]} chunks
     */
    _setSessionViewport(session, chunks) {
        const {added, removed} = this.bus.setViewport(session.id, chunks);
        if (added.length > 0 || removed.length > 0) {
            this.simEngine.invalidateObservers();
        }

        for (const chunk of removed) {
            this.bus.publishTo(session.id, new ChunkUnsubscribeEvent(chunk));
        }

        for (const chunk of added) {
            this.bus.publishTo(session.id, new ChunkSubscribeEvent(chunk));

            // Seed the chunk's claim (the client evicted it on unsubscribe), owner name first.
            const owner = this.claims.ownerOf(chunk);
            if (owner !== PLAYER_ID_NONE) {
                this.syncUsernames(session.id, [owner]);
                const permission = this.claims.permissionOf(chunk);
                this.bus.publishTo(session.id, new ChunkClaimUpdateEvent(chunk, owner, permission));
            }

            // Bundle the chunk's recreate events into one ChunkSyncEvent; the client unwraps it.
            const events = this.simEngine.chunkSync(chunk);
            if (events.length > 0) {
                this.bus.publishTo(session.id, new ChunkSyncEvent(chunk, events));
            }
        }
    }

    // ---- Overworld ----

    /**
     * Answers an overworld request from the hot bake, straight to the asking session.
     * @param {AbstractSession} session
     * @param {OverworldRequestMessage} message
     * @returns {void}
     */
    _sendOverworldSnapshot(session, message) {
        const snapshot = this.simEngine.overworldBake.snapshot(
            message.chunkX,
            message.chunkY,
            message.chunkWidth,
            message.chunkHeight,
        );
        // The bake knows tiles only; claims join here, owner names first so labels resolve.
        const claims = this.claims.claimsIn(
            message.chunkX,
            message.chunkY,
            message.chunkWidth,
            message.chunkHeight,
        );
        this.syncUsernames(session.id, claims.playerIds);
        snapshot.claimedChunks = claims.chunks;
        snapshot.claimOwners = claims.playerIds;
        snapshot.claimPermissions = claims.permissions;
        this.bus.publishTo(session.id, snapshot);
    }

    // ---- Inspect ----

    /**
     * Diffs the session's inspected-object set against the requested ids.
     * @param {AbstractSession} session
     * @param {number[]} objectIds
     * @returns {void}
     */
    _setSessionInspect(session, objectIds) {
        const {added} = this.bus.setInspects(session.id, objectIds);
        // Fill each new menu now, not on the next heartbeat.
        for (const objectId of added) {
            this._syncInspect(session, objectId);
        }
    }

    /**
     * Sends a session one object's current snapshot when its menu opens.
     * @param {AbstractSession} session
     * @param {number} objectId
     * @returns {void}
     */
    _syncInspect(session, objectId) {
        const snapshot = this.simEngine.inspectSnapshot(objectId);
        if (snapshot !== null) {
            this.bus.publishTo(session.id, snapshot);
        }
    }

    /**
     * Closes a deleted object's menu on every session inspecting it, then drops its subscriptions.
     * @param {number} objectId
     * @returns {void}
     */
    _closeInspect(objectId) {
        this.bus.publish(new InspectClosedEvent(objectId));
        this.bus.clearObject(objectId);
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
        this._dispatchInspectEvents();
        // Last thing in the tick: every client learns the clock it just reached, so nothing on the
        // client has to time ticks for itself.
        this.bus.publishToAll(new TickEndEvent(this.simEngine.clock));
    }

    /**
     * Publishes this tick's snapshot of every inspected object to its topic (fanning to all sessions
     * inspecting it), closing menus for any object that has since been removed.
     * @private
     */
    _dispatchInspectEvents() {
        for (const objectId of this.bus.subscribedObjects()) {
            const snapshot = this.simEngine.inspectSnapshot(objectId);
            if (snapshot === null) {
                this._closeInspect(objectId);
                continue;
            }
            this.bus.publish(snapshot);
        }
    }
}
