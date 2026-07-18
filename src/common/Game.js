import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {SetViewportMessage, SetInspectedObjectsMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {InspectClosedEvent} from "@/common/InspectEvents.js";
import {PlayerSettingsSyncEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent} from "@/common/GameSettingsEvents.js";
import {WireRegistry} from "@/common/wire.js";
import {GameEngine} from "@/common/sim/GameEngine.js";
import {EventBus} from "@/common/EventBus.js";
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
        const sessionId = this.bus.addSession(session);
        session.setId(sessionId);

        this._syncPlayerSettings(session);
        this._syncGameSettings(session);
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
    }

    // ---- Messages ----

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     */
    dispatchMessage(message, session) {
        // Core messages are handled here; the rest go to the engine's registered handlers.
        if (message instanceof SetViewportMessage) {
            this._setSessionViewport(session, message.chunks);
            return;
        }

        if (message instanceof SetInspectedObjectsMessage) {
            this._setSessionInspect(session, message.objectIds);
            return;
        }

        this.simEngine.applyMessage(message);

        // Close menus after the object is actually deleted, never before.
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
        const {added, removed} = this.bus.setViewport(session.id, chunks);

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
