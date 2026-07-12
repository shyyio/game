import {BufferedEvent} from "@/common/BufferedEvent.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";
import {SetViewportMessage, SetInspectedObjectsMessage, DeleteObjectMessage} from "@/common/CoreMessages.js";
import {InspectHeartbeatEvent, InspectClosedEvent} from "@/common/InspectEvents.js";
import {PlayerSettingsSyncEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent} from "@/common/GameSettingsEvents.js";
import {WireRegistry} from "@/common/wire.js";
import {SqlSimEngine} from "@/common/sim/SqlSimEngine.js";
import {SessionRegistry} from "@/common/SessionRegistry.js";

export class Game {

    /**
     * @param {ModRegistry} modRegistry
     * @param {AbstractDatabase} database
     */
    /**
     * @param {ModRegistry} modRegistry
     * @param {AbstractDatabase} database
     * @param {SimEngine} [simEngine] - the simulation engine; defaults to the SQL tick pipeline
     */
    constructor(modRegistry, database, simEngine) {
        this.db = database;
        this.modRegistry = modRegistry;

        /**
         * The simulation engine the tick pipeline runs through. Wraps the SQL pipeline by default; the
         * seam a bitECS engine takes over behind.
         * @type {SimEngine}
         */
        this.simEngine = simEngine === undefined ? new SqlSimEngine(database) : simEngine;

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
         * Engine-agnostic session/viewport index for event routing.
         * @type {SessionRegistry}
         */
        this.sessionRegistry = new SessionRegistry();
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
        const sessionId = this.queryScalar("InsertSession", {player_id: session.playerId});
        session.setId(sessionId);
        this.sessions[sessionId] = session;
        this.sessionRegistry.add(sessionId);

        this._syncPlayerSettings(session);
        this._syncGameSettings(session);
    }

    _syncGameSettings(session) {
        const infoRows = this.query("GetGameSettings", {});
        const infoValues = {};
        infoRows.forEach(row => {
            infoValues[row.key] = row.value;
        });
        session.publishEvent(new GameSettingsSyncEvent(infoValues));
    }

    /**
     * @param session {AbstractSession}
     * @private
     */
    _syncPlayerSettings(session) {
        const settingsRows = this.query("GetPlayerSettings", {player_id: session.playerId});
        const settingsValues = {};
        settingsRows.forEach(row => {
            settingsValues[row.key] = row.value;
        });
        session.publishEvent(new PlayerSettingsSyncEvent(settingsValues));
    }

    /**
     * @param {number} sessionId
     */
    disconnect(sessionId) {
        this.exec("DeleteSessionViewport", {session_id: sessionId});
        this.exec("DeleteSessionInspect", {session_id: sessionId});
        delete this.sessions[sessionId];
        this.sessionRegistry.remove(sessionId);
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
            this._flushEngineEvents();
            return;
        }

        this.modRegistry.dispatchMessage(message);

        // Close menus after the object is actually deleted, never before.
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
        // The registry owns the diff; the SQL SessionViewport rows are kept in step so the SQL tick's
        // viewport-gated emit ops still read them.
        const {added, removed} = this.sessionRegistry.setViewport(session.id, chunks);

        removed.forEach(chunk => {
            this.exec("DeleteSessionViewportChunk", {session_id: session.id, chunk});
            session.publishEvent(new ChunkUnsubscribeEvent(chunk));
        });

        added.forEach(chunk => {
            this.exec("InsertSessionViewport", {session_id: session.id, chunk});
            session.publishEvent(new ChunkSubscribeEvent(chunk));

            const syncEvents = this.modRegistry.chunkSyncEvents(chunk);
            if (syncEvents.length > 0) {
                session.publishEvent(new ChunkSyncEvent(chunk, syncEvents));
            }

            // The bitECS engine recreates its objects/items in the chunk directly (a no-op for the SQL
            // engine, whose objects come through the mods' chunkSyncEvents above).
            this.simEngine.chunkSync(chunk).forEach(event => {
                session.publishEvent(event);
            });
        });
    }

    // ---- Inspect ----

    /**
     * Diffs the session's inspected-object set against the requested ids.
     * @param {AbstractSession} session
     * @param {BigInt[]} objectIds
     * @returns {void}
     */
    _setSessionInspect(session, objectIds) {
        // Keyed by string id (dedups the message) mapping to the BigInt to bind.
        const requested = new Map(objectIds.map(id => [String(id), id]));
        const currentRows = this.query("GetSessionInspect", {session_id: session.id});
        const current = new Set(currentRows.map(row => String(row.object_id)));

        current.forEach(objectId => {
            if (requested.has(objectId)) {
                return;
            }
            this.exec("DeleteSessionInspectObject", {session_id: session.id, object_id: objectId});
        });

        requested.forEach((objectId, key) => {
            if (current.has(key)) {
                return;
            }
            this.exec("InsertSessionInspect", {session_id: session.id, object_id: objectId});
            // Fill the new menu now, not on the next heartbeat.
            this._syncInspect(session, objectId);
        });
    }

    /**
     * Sends a session one machine's current snapshot when its menu opens.
     * @param {AbstractSession} session
     * @param {BigInt} objectId
     * @returns {void}
     */
    _syncInspect(session, objectId) {
        this.db.schema.inspectStatements.forEach(name => {
            this.exec(name, {object_id: objectId});
        });
        const rows = this.query("GetInspectSnapshotRows");
        rows.forEach(row => {
            session.publishEvent(new InspectHeartbeatEvent(row));
        });
        this.exec("TruncateBufferedInspectHeartbeatEvent");
    }

    /**
     * Drops the deleted object's inspect subscriptions and closes its menu on those sessions.
     * @param {BigInt} objectId
     * @returns {void}
     */
    _closeInspect(objectId) {
        const sessions = this.query("GetSessionsInspectingObject", {object_id: objectId});
        this.exec("DeleteInspectObject", {object_id: objectId});
        sessions.forEach(row => {
            this.sessions[row.session_id].publishEvent(new InspectClosedEvent(objectId));
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
        this._dispatchBufferedEvents();
        this._dispatchInspectEvents();
        this._flushEngineEvents();
    }

    /**
     * Broadcasts the engine's buffered domain events (bitECS placement/path/delete + port-item render
     * deltas) to the sessions covering each event's chunk. A no-op for the SQL engine (it publishes
     * through the mods and the BufferedEvent journal).
     * @private
     * @returns {void}
     */
    _flushEngineEvents() {
        this.simEngine.drainEvents().forEach(event => {
            this.sessionRegistry.sessionsForChunk(event.chunk).forEach(sessionId => {
                this.sessions[sessionId].publishEvent(event);
            });
        });
    }

    // ---- Events ----

    /**
     * Dispatches a positioned event immediately to sessions covering its chunk, bypassing the BufferedEvent buffer.
     * @param {AbstractTilePositionedEvent} event
     */
    publishEventNow(event) {
        if (!(event instanceof AbstractTilePositionedEvent) && !(event instanceof BufferedEvent)) {
            throw new Error(`publishEventNow requires a chunk-routable event, got ${event.constructor.name}`);
        }
        this.sessionRegistry.sessionsForChunk(event.chunk).forEach(sessionId => {
            this.sessions[sessionId].publishEvent(event);
        });
    }

    /**
     * Dispatches each session its viewport's buffered events, then clears the journal.
     * @private
     */
    _dispatchBufferedEvents() {
        const rows = this.query("GetSessionEvents");

        rows.forEach(row => {
            this.sessions[row.session_id].publishEvent(new BufferedEvent(row));
        });
        this.exec("TruncateBufferedEvent");
    }

    /**
     * Sends this tick's machine snapshots to each subscribing session, then clears them.
     * @private
     */
    _dispatchInspectEvents() {
        const rows = this.query("GetSessionInspectEvents");

        rows.forEach(row => {
            this.sessions[row.session_id].publishEvent(new InspectHeartbeatEvent(row));
        });
        this.exec("TruncateBufferedInspectHeartbeatEvent");
    }
}
