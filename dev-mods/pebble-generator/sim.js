import {AbstractSimMod, AbstractSystem, PLAYER_REF_NONE} from "@spup/sdk";
import {PebbleGeneratorType, FirstGeneratorBonus} from "./common/objectTypes.js";
import {GeneratorCountRequestMessage} from "./common/messages.js";
import {GeneratorCountEvent} from "./common/events.js";

/**
 * Grants the belt bonus to a player the moment their first generator stands.
 */
class FirstGeneratorBonusSystem extends AbstractSystem {

    /**
     * @param {GameEngine} engine
     */
    constructor(engine) {
        super();
        this.engine = engine;
    }

    onSpawn(eid, objectRef) {
        const placed = this.engine.placed;
        if (placed.getObjectTypeIdByEid(eid) !== PebbleGeneratorType.objectTypeId) {
            return;
        }
        const playerRef = placed.getPlacerByEid(eid);
        if (playerRef === PLAYER_REF_NONE || this.engine.limits.isGranted(playerRef, FirstGeneratorBonus.bonusTypeId)) {
            return;
        }
        this.engine.limits.grant(playerRef, FirstGeneratorBonus.bonusTypeId);
    }
}

/**
 * The half of the mod that runs on the server, for anything a placed machine cannot do by itself.
 * This one answers a session that asks how many generators stand in the world, then tells it again
 * whenever the number changes.
 */
export class PebbleGeneratorSimMod extends AbstractSimMod {

    constructor() {
        super();
        /**
         * The sessions that asked for the count.
         * @type {Set<number>}
         */
        this._watcherSessionRefs = new Set();
        this._count = 0;
    }

    /**
     * The machine's behavior registers its own component and system; this adds the reward watcher.
     * @param {GameEngine} engine
     * @returns {void}
     */
    init(engine) {
        engine.registerSystem(new FirstGeneratorBonusSystem(engine));
    }

    /**
     * Sends nothing while the number holds still.
     * @param {Game} game
     * @returns {void}
     */
    onTick(game) {
        const count = this._countGenerators(game);
        if (count === this._count) {
            return;
        }
        this._count = count;
        for (const sessionRef of this._watcherSessionRefs) {
            game.bus.publishTo(sessionRef, new GeneratorCountEvent(count));
        }
    }

    /**
     * Answers the asking session alone; `publish` would tell everyone.
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {boolean}
     */
    onSessionMessage(message, session, game) {
        if (message instanceof GeneratorCountRequestMessage) {
            this._watcherSessionRefs.add(session.sessionRef);
            game.bus.publishTo(session.sessionRef, new GeneratorCountEvent(this._countGenerators(game)));
            return true;
        }
        return false;
    }

    /**
     * @param {number} sessionRef
     * @param {Game} game
     * @returns {void}
     */
    onSessionDisconnect(sessionRef, game) {
        this._watcherSessionRefs.delete(sessionRef);
    }

    /**
     * @param {Game} game
     * @returns {number}
     * @private
     */
    _countGenerators(game) {
        return game.simEngine.placed.getEidsByTypeId(PebbleGeneratorType.objectTypeId).length;
    }
}
