import {ChunkSubscribeEvent, ChunkUnsubscribeEvent} from "@/common/CoreEvents.js";
import {SetViewportMessage, SetInspectedObjectsMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {InspectClosedEvent} from "@/common/InspectEvents.js";
import {PlayerSettingsSyncEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent} from "@/common/GameSettingsEvents.js";
import {WireRegistry} from "@/common/wire.js";
import {EcsSimEngine} from "@/common/sim/EcsSimEngine.js";
import {SessionCache} from "@/common/SessionCache.js";
import {SettingsCache, PlayerSettingsCache} from "@/common/SettingsCache.js";
import {CHUNK_SIZE, GameSettingsKey} from "@/common/constants.js";

export class Game {

    /**
     * @param {ModRegistry} modRegistry
     * @param {AbstractDatabase} database
     * @param {SimEngine} [simEngine] - the simulation engine; defaults to the bitECS engine
     */
    constructor(modRegistry, database, simEngine) {
        this.db = database;
        this.modRegistry = modRegistry;

        /**
         * The bitECS simulation engine the tick pipeline runs through.
         * @type {SimEngine}
         */
        this.simEngine = simEngine === undefined ? new EcsSimEngine(modRegistry) : simEngine;

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
        this.modRegistry.mods.forEach(mod => {
            mod.game = this;
        });

        await this.db.init();
        await this.simEngine.init();
    }

    // ---- AbstractDatabase delegation ----

    exec(name, args) {
        return this.db.exec(name, args);
    }

    query(name, args) {
        return this.db.query(name, args);
    }

    querySingle(name, args) {
        return this.db.querySingle(name, args);
    }

    queryScalar(name, args) {
        return this.db.queryScalar(name, args);
    }

    begin() {
        this.db.begin();
    }

    end() {
        this.db.end();
    }

    rollback() {
        this.db.rollback();
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

        // A bitECS engine handles sim messages directly; the SQL path defers to the mods.
        if (this.simEngine.applyMessage(message)) {
            // Close menus after the object is actually deleted, never before.
            if (message instanceof DeleteObjectMessage) {
                this._closeInspect(message.id);
            }
            this._flushEngineEvents();
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
     * @param {string[]} chunks
     */
    _setSessionViewport(session, chunks) {
        const {added, removed} = this.sessionCache.setViewport(session.id, chunks);

        removed.forEach(chunk => {
            session.publishEvent(new ChunkUnsubscribeEvent(chunk));
        });

        added.forEach(chunk => {
            session.publishEvent(new ChunkSubscribeEvent(chunk));

            // The bitECS engine recreates its objects/items in the newly visible chunk.
            this.simEngine.chunkSync(chunk).forEach(event => {
                session.publishEvent(event);
            });
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
        this._flushEngineEvents();
    }

    /**
     * Broadcasts the engine's domain events (placement/path/delete + port-item render deltas) to the
     * sessions covering each event's chunk.
     * @private
     * @returns {void}
     */
    _flushEngineEvents() {
        this.simEngine.drainEvents().forEach(event => {
            this.sessionCache.sessionsForChunk(event.chunk).forEach(sessionId => {
                this.sessions[sessionId].publishEvent(event);
            });
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
