import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {SetViewportMessage, SetInspectedObjectsMessage, DeleteObjectMessage, OverworldRequestMessage} from "@/common/CoreMessages.js";
import {InspectClosedEvent} from "@/common/InspectEvents.js";
import {PlayerSettingsSyncEvent, PlayerSettingsUpdateEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent} from "@/common/GameSettingsEvents.js";
import {AddFriendMessage, RemoveFriendMessage, SetPlayerSettingMessage} from "@/common/PlayerMessages.js";
import {WelcomeEvent, PlayerDirectoryEvent, FriendListEvent} from "@/common/PlayerEvents.js";
import {ClaimChunkMessage, UnclaimChunkMessage} from "@/common/ClaimMessages.js";
import {ChunkClaimSyncEvent, ChunkClaimUpdateEvent, ClaimResultEvent, ClaimResult} from "@/common/ClaimEvents.js";
import {WireRegistry} from "@/common/wire.js";
import {GameEngine, TICK_PHASE_ORDER} from "@/sim/GameEngine.js";
import {EventBus} from "@/sim/EventBus.js";
import {SettingsCache, PlayerSettingsCache, PLAYER_SETTING_RECORD} from "@/common/SettingsCache.js";
import {ChunkClaims, CHUNK_CLAIM_RECORD} from "@/sim/ChunkClaims.js";
import {PlayerRegistry, PLAYER_RECORD, FRIEND_RECORD} from "@/sim/PlayerRegistry.js";
import {CHUNK_SIZE, GameSettingsKey, PLAYER_ID_NONE} from "@/common/constants.js";

export class Game {

    /**
     * @param {ModRegistry} modRegistry
     * @param {GameEngine} [simEngine] - the simulation engine; defaults to a fresh GameEngine
     * @param {AbstractSaveStore} [saveStore] - persists/restores the world; omitted when saving is off
     */
    constructor(modRegistry, simEngine, saveStore) {
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

        /**
         * @type {PlayerSettingsCache}
         */
        this.playerSettings = new PlayerSettingsCache();

        /**
         * @type {PlayerRegistry}
         */
        this.players = new PlayerRegistry();

        /**
         * @type {ChunkClaims}
         */
        this.claims = new ChunkClaims();
        this.simEngine.setPlacementGate((playerId, chunk) => this._canBuildIn(playerId, chunk));
    }

    /**
     * Whether a player may modify a chunk: it is unclaimed, their own, or a friend's.
     * @param {number} playerId
     * @param {number} chunk
     * @returns {boolean}
     * @private
     */
    _canBuildIn(playerId, chunk) {
        const owner = this.claims.ownerOf(chunk);
        if (owner === PLAYER_ID_NONE || owner === playerId) {
            return true;
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
        ];
        await this.saveStore.save(snapshot);
    }

    /**
     * Restores the world from the save store, if a save exists.
     * @returns {Promise<boolean>} whether a save was loaded
     */
    async load() {
        const snapshot = await this.saveStore.load();
        if (snapshot === null) {
            return false;
        }
        this.simEngine.deserialize(snapshot);
        const records = snapshot.records === undefined ? [] : snapshot.records;
        const byName = new Map(records.map(table => [table.name, table]));
        this.players.deserializeRecords(byName.get(PLAYER_RECORD), byName.get(FRIEND_RECORD));
        this.claims.deserializeRecords(byName.get(CHUNK_CLAIM_RECORD));
        this.playerSettings.deserializeRecords(byName.get(PLAYER_SETTING_RECORD));
        return true;
    }

    // ---- Sessions ----

    /**
     * @param {AbstractSession} session
     */
    connect(session) {
        const sessionId = this.bus.addSession(session);
        session.setId(sessionId);
        // Local and test sessions carry ids the registry has never seen; the server registers its
        // players before connecting them, so this is a no-op there.
        this.players.ensure(session.playerId);

        this._syncPlayerSettings(session);
        this._syncGameSettings(session);
        this._syncPlayerState(session);
    }

    /**
     * Sends a fresh session its identity, the player directory, the claim map, and its friends.
     * @param {AbstractSession} session
     * @private
     */
    _syncPlayerState(session) {
        const record = this.players.byId(session.playerId);
        this.bus.publishTo(session.id, new WelcomeEvent(record.playerId, record.maxChunks));
        const directory = this.players.directory();
        this.bus.publishTo(session.id, new PlayerDirectoryEvent(directory.playerIds, directory.usernames));
        const claims = this.claims.snapshot();
        this.bus.publishTo(session.id, new ChunkClaimSyncEvent(claims.chunks, claims.playerIds));
        this.bus.publishTo(session.id, new FriendListEvent([...record.friends]));
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
     * @param {number} sessionId
     */
    disconnect(sessionId) {
        this.bus.removeSession(sessionId);
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
            this._handleUnclaim(session, message.chunk);
            return;
        }

        if (message instanceof AddFriendMessage) {
            this._handleAddFriend(session, message.username);
            return;
        }

        if (message instanceof RemoveFriendMessage) {
            this.players.removeFriend(session.playerId, message.playerId);
            this._syncFriendList(session);
            return;
        }

        if (message instanceof SetPlayerSettingMessage) {
            const entry = this.modRegistry.playerSettingEntry(message.key);
            // Unknown keys and server-authoritative keys (progress, unlocks) are never
            // client-writable; hostile input drops silently, like a failed validate.
            if (entry === undefined || !entry.clientWritable) {
                return;
            }
            this.playerSettings.set(session.playerId, message.key, message.value);
            this.bus.publishTo(session.id, new PlayerSettingsUpdateEvent(message.key, message.value));
            for (const mod of this.modRegistry.simMods) {
                mod.onPlayerSettingWritten(session, message.key, message.value, this);
            }
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
            this.bus.publish(new ChunkClaimUpdateEvent(chunk, session.playerId));
        }
        this.bus.publishTo(session.id, new ClaimResultEvent(chunk, result));
    }

    /**
     * @param {AbstractSession} session
     * @param {number} chunk
     * @private
     */
    _handleUnclaim(session, chunk) {
        const result = this.claims.unclaim(session.playerId, chunk);
        if (result === ClaimResult.CLAIM_RESULT_OK) {
            this.bus.publish(new ChunkClaimUpdateEvent(chunk, PLAYER_ID_NONE));
        }
        this.bus.publishTo(session.id, new ClaimResultEvent(chunk, result));
    }

    /**
     * Befriends by username; an unknown name just re-sends the unchanged list.
     * @param {AbstractSession} session
     * @param {string} username
     * @private
     */
    _handleAddFriend(session, username) {
        const friend = this.players.findByUsername(username);
        if (friend !== null && friend.playerId !== session.playerId) {
            this.players.addFriend(session.playerId, friend.playerId);
        }
        this._syncFriendList(session);
    }

    /**
     * @param {AbstractSession} session
     * @private
     */
    _syncFriendList(session) {
        this.bus.publishTo(session.id, new FriendListEvent([...this.players.byId(session.playerId).friends]));
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
        this.postTick();
    }

    postTick() {
        this._dispatchInspectEvents();
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
