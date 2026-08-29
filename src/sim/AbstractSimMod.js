import {NotImplementedError} from "@/common/error.js";

/**
 * The optional sim part of a mod: bespoke ECS content registered on the engine. A sim mod defines
 * components (engine.components.define), registers per-phase systems (engine.registerSystem), and
 * handles its spawn/despawn messages (engine.registerMessageHandler) plus chunk sync and inspection.
 */
export class AbstractSimMod {

    /**
     * Registers this mod's ECS content on the engine.
     * @param {GameEngine} engine
     * @returns {void}
     */
    setup(engine) {
        throw new NotImplementedError();
    }

    /**
     * Optional hook: handles a session-level message (one needing the session/bus, not the ECS),
     * after the core handlers and before the engine's message handlers.
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {boolean} whether the message was consumed
     */
    onSessionMessage(message, session, game) {
        return false;
    }

    /**
     * Optional hook: a session joined, before any of its state is synced.
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {void}
     */
    onSessionConnect(session, game) {}

    /**
     * Optional hook: a session left; its bus subscriptions are already gone.
     * @param {number} sessionId
     * @param {Game} game
     * @returns {void}
     */
    onSessionDisconnect(sessionId, game) {}

    /**
     * Optional hook: a player dropped another from their friend list (already applied and synced).
     * @param {number} playerId
     * @param {number} friendId
     * @param {Game} game
     * @returns {void}
     */
    onFriendRemoved(playerId, friendId, game) {}

    /**
     * Optional hook: a client wrote one of its player settings (already stored and echoed).
     * @param {AbstractSession} session
     * @param {number} key
     * @param {number} value
     * @param {Game} game
     * @returns {void}
     */
    onPlayerSettingWritten(session, key, value, game) {}

    /**
     * Optional hook: a session subscribed to a chunk, before that chunk's sync bundle is sent.
     * @param {AbstractSession} session
     * @param {number} chunk
     * @param {Game} game
     * @returns {void}
     */
    onChunkSubscribed(session, chunk, game) {}

    /**
     * Optional hook: runs once per tick, after every phase has resolved for this tick.
     * @param {Game} game
     * @returns {void}
     */
    onTick(game) {}

    /**
     * Optional hook: the record tables this mod contributes to the world save.
     * @returns {object[]}
     */
    serializeRecords() {
        return [];
    }

    /**
     * Optional hook: restores this mod's record tables; a missing table is an older save.
     * @param {Map<string, object>} tablesByName
     * @returns {void}
     */
    deserializeRecords(tablesByName) {}
}
