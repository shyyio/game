// Mod SDK — test surface (Node-only).
//
// Unlike `@/sdk/common.js` (client + server) and `@/sdk/client.js` (browser),
// this entry is for running a mod's `*.spec.js` under `node:test`. It boots a
// real in-memory game with your mods loaded and hands back a small harness, so a
// mod's tests don't have to re-derive the registry/schema/database/session wiring.
//
// It imports the Node database backend, so it must only be used from tests run
// under Node (the `@/` alias is resolved there by `src/test/test-loader.js` —
// see the "test" script in package.json). The future runtime mod loader exposes this
// to zip-installed mods as the bare specifier "pipesjs/test".

import {ModRegistry} from "@/common/ModRegistry.js";
import {DatabaseSchema} from "@/common/DatabaseSchema.js";
import {NodeDatabase} from "@/server/NodeDatabase.js";
import {Game} from "@/common/Game.js";
import {GameAPI} from "@/common/GameAPI.js";
import {LocalSession} from "@/common/LocalSession.js";
import {TickPhase} from "@/common/core.js";

// Re-exported so a spec can advance specific phases without a second import.
export {TickPhase} from "@/common/core.js";

/**
 * A booted single-player game for tests: one connected LocalSession against an
 * in-memory NodeDatabase. Thin by design — it forwards player intents and exposes
 * raw SQL reads so a mod's own test helpers can assert on engine state. Reach
 * `game` / `session` / `db` directly for anything this doesn't wrap.
 */
export class TestHarness {

    /**
     * @param {Game} game
     * @param {NodeDatabase} db
     * @param {LocalSession} session
     */
    constructor(game, db, session) {
        this.game = game;
        this.db = db;
        this.session = session;
    }

    /**
     * Sends a player message to the game as the connected session, exactly as a
     * client would.
     * @param {AbstractMessage} message
     */
    dispatchMessage(message) {
        this.game.dispatchMessage(message, this.session);
    }

    /**
     * Runs a single tick phase.
     * @param {TickPhase} phase
     */
    tick(phase) {
        this.game.tick(phase);
    }

    /**
     * Runs one whole tick: all four phases in pipeline order, as Game.vue does
     * each frame.
     */
    tickAll() {
        this.game.tick(TickPhase.SUBMIT_INTENTS);
        this.game.tick(TickPhase.RESOLVE_TRANSFERS);
        this.game.tick(TickPhase.POST_RESOLVE);
        this.game.tick(TickPhase.COMMIT_TRANSFERS);
    }

    /**
     * Runs a named prepared statement (one a mod registered via its `statements`
     * getter), as the engine does each tick. Returns the number of changed rows.
     * @param {string} name
     * @param {Object} [args]
     * @returns {number}
     */
    exec(name, args) {
        return this.game.exec(name, args);
    }

    /**
     * Runs a named prepared statement and returns the scalar value of the first
     * column of the first row, or undefined if no rows matched.
     * @param {string} name
     * @param {Object} [args]
     * @returns {*}
     */
    queryScalar(name, args) {
        return this.game.queryScalar(name, args);
    }

    /**
     * Executes literal SQL, ignoring any result rows — for seeding or mutating
     * state a spec wants to assert against.
     * @param {string} sql
     */
    rawExec(sql) {
        this.db.rawExec(sql);
    }

    /**
     * Runs literal SQL and returns the scalar value of the first column of the
     * first row, or undefined if no rows matched.
     * @param {string} sql
     * @returns {*}
     */
    rawScalar(sql) {
        return this.db.rawScalar(sql);
    }
}

/**
 * Boots an in-memory game with the given mods loaded and a session connected.
 * The one piece of setup every mod's tests share.
 * @param {AbstractMod[]} mods
 * @returns {Promise<TestHarness>}
 */
export async function setupGame(mods) {
    const modRegistry = new ModRegistry();
    mods.forEach(mod => {
        modRegistry.loadMod(mod);
    });

    const schema = new DatabaseSchema(modRegistry);
    const db = new NodeDatabase(schema);
    const game = new Game(modRegistry, db);
    await game.init();

    const api = new GameAPI(game);
    const session = new LocalSession(api);
    game.connect(session);

    return new TestHarness(game, db, session);
}
