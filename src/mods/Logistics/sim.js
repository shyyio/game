import {AbstractSimMod, chunkId} from "@spup/sdk";
import {SetGateOpenMessage} from "./common/messages.js";
import {GateSetEvent} from "./common/events.js";
import {isGateType} from "./common/objectTypes.js";

/**
 * Handles the Logistics mod's session messages; all tick logic lives in the behaviors.
 */
export class LogisticsSimMod extends AbstractSimMod {

    /**
     * No engine content; everything installs through the behaviors.
     * @param {GameEngine} sim
     * @returns {void}
     */
    setup(sim) {
    }

    /**
     * @param {AbstractMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @returns {boolean}
     */
    onSessionMessage(message, session, game) {
        if (message instanceof SetGateOpenMessage) {
            this._handleSetGateOpen(message, session, game);
            return true;
        }
        return false;
    }

    /**
     * Buffers a toggle for anyone with build rights on the gate's chunk.
     * @param {SetGateOpenMessage} message
     * @param {AbstractSession} session
     * @param {Game} game
     * @private
     */
    _handleSetGateOpen(message, session, game) {
        const engine = game.simEngine;
        const eid = engine.placed.eidByObjectId(message.objectId);
        if (eid === undefined) {
            return;
        }
        const typeId = engine.placed.typeIdOf(eid);
        const type = engine.placed.typeFor(typeId);
        if (type === undefined || !isGateType(type)) {
            return;
        }
        const x = engine.Position.x[eid];
        const y = engine.Position.y[eid];
        // Mod messages bypass the core placement gate, so gates check build rights themselves.
        if (!engine.placementAllowed(session.playerId, chunkId(x, y))) {
            // Correct the sender's optimistic flip with the authoritative state.
            const def = engine.component("Gate");
            const row = def.row(eid);
            game.bus.publishTo(session.id, new GateSetEvent(x, y, message.objectId, def.store.open[row], def.store.fluid[row]));
            return;
        }
        engine.placed.behaviorFor(typeId).requestOpen(engine, eid, message.open === 1);
    }
}
