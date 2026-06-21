
import {BufferedEvent} from "@/common/BufferedEvent.js";
import {EVENT_TYPE_CORE, EVENT_SUBTYPE_CHUNK_SUBSCRIBE, EVENT_SUBTYPE_CHUNK_UNSUBSCRIBE} from "@/common/core.js";
import {SetViewportMessage} from "@/common/CoreMessages.js";
import {PlayerSettingsSyncEvent} from "@/common/PlayerSettingsEvents.js";
import {GameSettingsSyncEvent} from "@/common/GameSettingsEvents.js";

export class Game {

    /**
     * @param {ModSet} modSet
     * @param {Database} database
     */
    constructor(modSet, database) {
        this.db = database;
        this.modSet = modSet;
        this.time = 0;

        /**
         * @type {Object.<number, Session>}
         */
        this.sessions = {};
    }

    async init() {
        this.modSet.mods.forEach(mod => {
            mod.game = this;
        });

        await this.db.init();
    }

    // ---- Database delegation ----

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
     * @param {Session} session
     */
    connect(session) {
        const sessionId = this.queryScalar("InsertSession", {user: 0});
        session.setId(sessionId);
        this.sessions[sessionId] = session;

        const settingsRows = this.query("GetPlayerSettings", {player: 0});
        const settingsValues = {};
        settingsRows.forEach(row => {
            settingsValues[row.key] = row.value;
        });
        session.publishEvent(new PlayerSettingsSyncEvent(settingsValues));

        const infoRows = this.query("GetGameSettings", {});
        const infoValues = {};
        infoRows.forEach(row => {
            infoValues[row.key] = row.value;
        });
        session.publishEvent(new GameSettingsSyncEvent(infoValues));
    }

    /**
     * @param {number} sessionId
     */
    disconnect(sessionId) {
        this.exec("DeleteSessionViewport", {session: sessionId});
        delete this.sessions[sessionId];
    }

    // ---- Messages ----

    /**
     * @param {Message} message
     * @param {Session} session
     */
    dispatchMessage(message, session) {
        // Core Events are handled here, and other events are dispatched to mods
        if (message instanceof SetViewportMessage) {
            this._setSessionViewport(session, message.chunks);
            return;
        }

        this.modSet.dispatchMessage(message);
    }

    // ---- Viewport ----

    /**
     * @param {Session} session
     * @param {string[]} chunks
     */
    _setSessionViewport(session, chunks) {
        this.query("DeleteSessionViewport", {session: session.id}).forEach(row => {
            session.publishEvent(new BufferedEvent({
                type: EVENT_TYPE_CORE,
                subtype: EVENT_SUBTYPE_CHUNK_UNSUBSCRIBE,
                chunk: row.chunk,
            }));
        });
        chunks.forEach(chunk => {
            this.exec("InsertSessionViewport", {session: session.id, chunk});
            session.publishEvent(new BufferedEvent({
                type: EVENT_TYPE_CORE,
                subtype: EVENT_SUBTYPE_CHUNK_SUBSCRIBE,
                chunk,
            }));
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
     * Writes an event to the GameJournal.
     * @param {number} type
     * @param {number} subtype
     * @param {number} x
     * @param {number} y
     * @param {BigInt} id
     * @param [a] {BigInt|number|null}
     * @param [b] {BigInt|number|null}
     * @param [c] {BigInt|number|null}
     */
    publishEvent(type, subtype, x, y, id, a=null, b=null, c=null) {
        this.exec("InsertGameJournal", {type, subtype, x, y, id, a, b, c});
    }

    /**
     * Dispatches a LiveEvent immediately to all sessions whose viewport covers the event's chunk,
     * bypassing GameJournal. Use when the event must reach clients before postTick().
     * @param {LiveEvent} event
     */
    publishEventNow(event) {
        const sessions = this.query("GetSessionsByChunk", {chunk: event.chunk});
        sessions.forEach(row => {
            this.sessions[row.session].publishEvent(event);
        });
    }

    /**
     * Reads events from GameJournal that fall within each session's viewport,
     * dispatches them to the appropriate session, then clears the journal.
     */
    _dispatchEvents() {
        this.query("GetSessionEvents").forEach(row => {
            this.sessions[row.session].publishEvent(new BufferedEvent(row));
        });
        this.exec("TruncateGameJournal");
    }
}
