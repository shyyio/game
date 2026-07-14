import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {SetViewportMessage, SetInspectedObjectsMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {InspectClosedEvent} from "@/common/InspectEvents.js";
import {PlayerSettingsSyncEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent} from "@/common/GameSettingsEvents.js";
import {WireRegistry} from "@/common/wire.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {SessionCache} from "@/common/SessionCache.js";
import {SettingsCache, PlayerSettingsCache} from "@/common/SettingsCache.js";
import {CHUNK_SIZE, GameSettingsKey} from "@/common/constants.js";

export class Game {

    /**
     * @param {ModRegistry} modRegistry
     * @param {GameEngine} [simEngine] - the simulation engine; defaults to the bitECS engine
     * @param {AbstractSaveStore} [saveStore] - persists/restores the world; omitted when saving is off
     */
    constructor(modRegistry, simEngine, saveStore) {
        this.modRegistry = modRegistry;
        this.saveStore = saveStore;

        /**
         * The bitECS simulation engine the tick pipeline runs through.
         * @type {GameEngine}
         */
        this.simEngine = simEngine === undefined ? new GameEngine(modRegistry) : simEngine;
        // Broadcast each domain event synchronously to the sessions covering its chunk.
        this.simEngine.setEventSink(event => this._broadcastEvent(event));

        /**
         * Protobuf wire codec registry, shared by sessions to encode/decode
         * messages and events.
         * @type {WireRegistry}
         */
        this.wire = new WireRegistry(modRegistry);

        /**
         * @type {Object.<number, AbstractSession>}
         */
        this.sessions = {};

        /**
         * Engine-agnostic session/viewport cache for event routing.
         * @type {SessionCache}
         */
        this.sessionCache = new SessionCache();

        /**
         * @type {SettingsCache}
         */
        this.gameSettings = new SettingsCache();
        this.gameSettings.set(GameSettingsKey.CHUNK_SIZE, CHUNK_SIZE);

        /**
         * @type {PlayerSettingsCache}
         */
        this.playerSettings = new PlayerSettingsCache();
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
        await this.saveStore.save(this.simEngine.serialize());
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
        return true;
    }

    // ---- Sessions ----

    /**
     * @param {AbstractSession} session
     */
    connect(session) {
        const sessionId = this.sessionCache.add();
        session.setId(sessionId);
        this.sessions[sessionId] = session;

        this._syncPlayerSettings(session);
        this._syncGameSettings(session);
    }

    _syncGameSettings(session) {
        session.publishEvent(new GameSettingsSyncEvent(this.gameSettings.snapshot()));
    }

    /**
     * @param session {AbstractSession}
     * @private
     */
    _syncPlayerSettings(session) {
        session.publishEvent(new PlayerSettingsSyncEvent(this.playerSettings.snapshot(session.playerId)));
    }

    /**
     * @param {number} sessionId
     */
    disconnect(sessionId) {
        delete this.sessions[sessionId];
        this.sessionCache.remove(sessionId);
    }

    // ---- Messages ----

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     */
    dispatchMessage(message, session) {
        // Core Events are handled here, and other events are dispatched to mods
        if (message instanceof SetViewportMessage) {
            this._setSessionViewport(session, message.chunks);
            return;
        }

        if (message instanceof SetInspectedObjectsMessage) {
            this._setSessionInspect(session, message.objectIds);
            return;
        }

        // The engine handles sim messages directly; anything it declines falls through to the mods.
        if (this.simEngine.applyMessage(message)) {
            // Close menus after the object is actually deleted, never before.
            if (message instanceof DeleteObjectMessage) {
                this._closeInspect(message.id);
            }
            return;
        }

        this.modRegistry.dispatchMessage(message);

        if (message instanceof DeleteObjectMessage) {
            this._closeInspect(message.id);
        }
    }

    // ---- Viewport ----

    /**
     * Diffs the session's viewport against the requested chunks so a pan only syncs the delta.
     * @param {AbstractSession} session
     * @param {number[]} chunks
     */
    _setSessionViewport(session, chunks) {
        const {added, removed} = this.sessionCache.setViewport(session.id, chunks);

        removed.forEach(chunk => {
            session.publishEvent(new ChunkUnsubscribeEvent(chunk));
        });

        added.forEach(chunk => {
            session.publishEvent(new ChunkSubscribeEvent(chunk));

            // Bundle the chunk's recreate events into one ChunkSyncEvent; the client unwraps it.
            const events = this.simEngine.chunkSync(chunk);
            if (events.length > 0) {
                session.publishEvent(new ChunkSyncEvent(chunk, events));
            }
        });
    }

    // ---- Inspect ----

    /**
     * Diffs the session's inspected-object set against the requested ids.
     * @param {AbstractSession} session
     * @param {number[]} objectIds
     * @returns {void}
     */
    _setSessionInspect(session, objectIds) {
        const {added} = this.sessionCache.setInspects(session.id, objectIds);
        // Fill each new menu now, not on the next heartbeat.
        added.forEach(objectId => this._syncInspect(session, objectId));
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
            session.publishEvent(snapshot);
        }
    }

    /**
     * Drops the deleted object's inspect subscriptions and closes its menu on those sessions.
     * @param {number} objectId
     * @returns {void}
     */
    _closeInspect(objectId) {
        this.sessionCache.sessionsInspecting(objectId).forEach(sessionId => {
            this.sessionCache.removeInspect(sessionId, objectId);
            this.sessions[sessionId].publishEvent(new InspectClosedEvent(objectId));
        });
    }

    // ---- Tick ----

    /**
     * @param {TickPhase} phase
     */
    tick(phase) {
        this.simEngine.tick(phase);
    }

    postTick() {
        this._dispatchInspectEvents();
    }

    /**
     * Broadcasts one engine domain event (placement/path/delete + port-item render deltas) to the
     * sessions covering its chunk.
     * @private
     * @param {AbstractTilePositionedEvent} event
     * @returns {void}
     */
    _broadcastEvent(event) {
        this.sessionCache.sessionsForChunk(event.chunk).forEach(sessionId => {
            this.sessions[sessionId].publishEvent(event);
        });
    }

    /**
     * Sends each subscribing session this tick's snapshot of every object it inspects, closing menus
     * for any object that has since been removed.
     * @private
     */
    _dispatchInspectEvents() {
        this.sessionCache.forEachSession(sessionId => {
            this.sessionCache.inspects(sessionId).forEach(objectId => {
                const snapshot = this.simEngine.inspectSnapshot(objectId);
                if (snapshot === null) {
                    this.sessionCache.removeInspect(sessionId, objectId);
                    this.sessions[sessionId].publishEvent(new InspectClosedEvent(objectId));
                    return;
                }
                this.sessions[sessionId].publishEvent(snapshot);
            });
        });
    }
}
