
import {ModSet} from "@/common/ModSet.js";
import {BeltMod} from "@/mods/Belt/mod.js";
import {SplitterMod} from "@/mods/Splitter/mod.js";
import {DatabaseSchema} from "@/common/DatabaseSchema.js";
import {NodeDatabase} from "@/server/NodeDatabase.js";
import {Game} from "@/common/Game.js";
import {GameAPI} from "@/common/GameAPI.js";
import {LocalSession} from "@/common/session.js";
import {CreateBeltMessage, DeleteBeltMessage} from "@/mods/Belt/messages.js";
import {TickPhase} from "@/common/core.js";

const BELT_NORMAL   = 0;
const BELT_RAMP_DOWN = 1;
const BELT_RAMP_UP   = 2;

/**
 * @enum
 */
export const GameObject = {
    BELT:      BELT_NORMAL,
    RAMP_DOWN: BELT_RAMP_DOWN,
    RAMP_UP:   BELT_RAMP_UP,
};

export class TestBackend {

    /**
     * @param {Game} game
     * @param {NodeDatabase} db
     * @param {LocalSession} session
     */
    constructor(game, db, session) {
        this._game = game;
        this._db = db;
        this._session = session;
    }

    createBelt(beltType, options) {
        this._game.dispatchMessage(new CreateBeltMessage({
            x: options.x,
            y: options.y,
            direction: options.direction,
            beltType,
            rampParent: options.rampParent,
            disconnectRampChild: options.disconnectRampChild,
        }), this._session);
    }

    removeGameObject(type, id) {
        this._game.dispatchMessage(new DeleteBeltMessage(id), this._session);
    }

    /**
     * Run raw SQL and return the scalar value of the first column of the first row,
     * or undefined if no rows matched.
     * @param {string} sql
     * @returns {*}
     */
    exec(sql) {
        return this._db.rawScalar(sql);
    }

    tickBeltPath() {
        this._game.tick(TickPhase.SUBMIT_INTENTS);
        this._game.tick(TickPhase.RESOLVE_TRANSFERS);
        this._game.tick(TickPhase.POST_RESOLVE);
        this._game.tick(TickPhase.COMMIT_TRANSFERS);
    }

}

export async function setup() {
    const modSet = new ModSet();
    modSet.loadMod(new BeltMod());
    modSet.loadMod(new SplitterMod());

    const schema = new DatabaseSchema(modSet);
    const db = new NodeDatabase(schema);
    const game = new Game(modSet, db);
    await game.init();

    const api = new GameAPI(game);
    const session = new LocalSession(api);
    game.connect(session);

    return new TestBackend(game, db, session);
}
