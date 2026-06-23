import {BufferedEvent} from "@/common/BufferedEvent.js";
import {ChunkSubscribeEvent, ChunkUnsubscribeEvent, ChunkSyncEvent} from "@/common/CoreEvents.js";
import {AbstractTilePositionedEvent} from "@/common/AbstractTilePositionedEvent.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {PlayerSettingsSyncEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent} from "@/common/GameSettingsEvents.js";
import {WireRegistry} from "@/common/wire.js";

export class Game {

    /**
     * @param {ModRegistry} modRegistry
     * @param {AbstractDatabase} database
     */
    constructor(modRegistry, database) {
        this.db = database;
        this.modRegistry = modRegistry;
        this.time = 0;

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
    }

    async init() {
        this.modRegistry.mods.forEach(mod => {
            mod.game = this;
        });

        await this.db.init();
    }

    // ---- AbstractDatabase delegation ----

    _defaultArgs() {
        return {time: this.time};
    }

    exec(name, args) {
        const merged = Object.assign({}, this._defaultArgs(), args);
        return this.db.exec(name, merged);
    }

    query(name, args) {
        const merged = Object.assign({}, this._defaultArgs(), args);
        return this.db.query(name, merged);
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
        // TODO: Get player ID from session
        const sessionId = this.queryScalar("InsertSession", {player_id: 0});
        session.setId(sessionId);
        this.sessions[sessionId] = session;

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

    _syncPlayerSettings(session) {
        // TODO: Get player ID from session
        const settingsRows = this.query("GetPlayerSettings", {player_id: 0});
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
        delete this.sessions[sessionId];
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

        this.modRegistry.dispatchMessage(message);
    }

    // ---- Viewport ----

    /**
     * Diffs the session's current viewport against the requested chunk set, so a
     * pan only syncs the delta (the hot path: a one-chunk move re-syncs one row of
     * chunks, not the whole screen). Removed chunks get an unsubscribe; added chunks
     * get a subscribe plus, when they hold objects, one ChunkSyncEvent seeding them.
     * @param {AbstractSession} session
     * @param {string[]} chunks
     */
    _setSessionViewport(session, chunks) {
        const requested = new Set(chunks);
        const currentRows = this.query("GetSessionViewport", {session_id: session.id});
        const current = new Set(currentRows.map(row => row.chunk));

        current.forEach(chunk => {
            if (requested.has(chunk)) {
                return;
            }
            this.exec("DeleteSessionViewportChunk", {session_id: session.id, chunk});
            session.publishEvent(new ChunkUnsubscribeEvent(chunk));
        });

        requested.forEach(chunk => {
            if (current.has(chunk)) {
                return;
            }
            this.exec("InsertSessionViewport", {session_id: session.id, chunk});
            session.publishEvent(new ChunkSubscribeEvent(chunk));

            const seedEvents = this.modRegistry.collectChunkSync(chunk);
            if (seedEvents.length > 0) {
                session.publishEvent(new ChunkSyncEvent(chunk, seedEvents));
            }
        });
    }

    // ---- Tick ----

    /**
     * @param {TickPhase} phase
     */
    tick(phase) {
        this.db.schema.tickPhases[phase].forEach(op => {
            this.exec(op.statementName);
        });
    }

    postTick() {
        this._dispatchEvents();
    }

    // ---- Events ----

    /**
     * Dispatches an AbstractTilePositionedEvent immediately to all sessions whose viewport covers
     * the event's chunk, bypassing GameJournal. Use when the event must reach clients
     * before postTick(). Routing is by chunk, so the event must carry a position — a
     * position-less AbstractEvent would match no session and vanish silently.
     * @param {AbstractTilePositionedEvent} event
     */
    publishEventNow(event) {
        if (!(event instanceof AbstractTilePositionedEvent)) {
            throw new Error(`publishEventNow requires a positioned event, got ${event.constructor.name}`);
        }
        const sessions = this.query("GetSessionsByChunk", {chunk: event.chunk});

        sessions.forEach(row => {
            this.sessions[row.session_id].publishEvent(event);
        });
    }

    /**
     * Reads events from GameJournal that fall within each session's viewport,
     * dispatches them to the appropriate session, then clears the journal.
     */
    _dispatchEvents() {
        const rows = this.query("GetSessionEvents");

        rows.forEach(row => {
            this.sessions[row.session_id].publishEvent(new BufferedEvent(row));
        });
        this.exec("TruncateGameJournal");
    }
}
